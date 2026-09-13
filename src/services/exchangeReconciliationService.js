export default class ExchangeReconciliationService {
  constructor({
    mexcClient,
    exchangeOrderRepository,
    exchangeOrderFillMonitorService,
    tradingCycleRepository,
    dcaOrderRepository,
    fillRepository,
  }) {
    this.mexcClient = mexcClient;
    this.exchangeOrderRepository =
      exchangeOrderRepository;
    this.exchangeOrderFillMonitorService =
      exchangeOrderFillMonitorService;
    this.tradingCycleRepository =
      tradingCycleRepository;
    this.dcaOrderRepository =
      dcaOrderRepository;
    this.fillRepository =
      fillRepository;
  }

  auditDbConsistency(exchangeOrder) {
    const issues = [];

    const cycle =
      this.tradingCycleRepository?.findById(
        exchangeOrder.trading_cycle_id,
      );

    if (!cycle) {
      issues.push("TRADING_CYCLE_MISSING");
    } else if (
      String(cycle.symbol) !==
      String(exchangeOrder.symbol)
    ) {
      issues.push("CYCLE_SYMBOL_MISMATCH");
    }

    if (exchangeOrder.dca_order_id !== null) {
      const dcaOrder =
        this.dcaOrderRepository?.findById(
          exchangeOrder.dca_order_id,
        );

      if (!dcaOrder) {
        issues.push("DCA_ORDER_MISSING");
      } else {
        if (
          Number(dcaOrder.trading_cycle_id) !==
          Number(exchangeOrder.trading_cycle_id)
        ) {
          issues.push("DCA_CYCLE_MISMATCH");
        }

        if (
          String(dcaOrder.symbol) !==
          String(exchangeOrder.symbol)
        ) {
          issues.push("DCA_SYMBOL_MISMATCH");
        }
      }
    }

    const fills =
      this.fillRepository?.findByExchangeOrderId(
        exchangeOrder.id,
      ) ?? [];

    if (
      String(exchangeOrder.status).toUpperCase() ===
        "FILLED" &&
      fills.length === 0
    ) {
      issues.push("FILLED_ORDER_WITHOUT_FILL");
    }

    return {
      consistent: issues.length === 0,
      issues,
      fillCount: fills.length,
    };
  }

  normalizeStatus(response) {
    return String(
      response?.status ??
      response?.orderStatus ??
      response?.data?.status ??
      "",
    ).toUpperCase();
  }

  async reconcileOrder(exchangeOrder) {
    const exchangeOrderId = String(
      exchangeOrder.exchange_order_id ?? "",
    );

    const symbol = String(
      exchangeOrder.symbol ?? "",
    );

    if (!exchangeOrderId || !symbol) {
      return {
        exchangeOrderId,
        symbol,
        status: "INVALID_LOCAL_ORDER",
        match: false,
      };
    }

    const response =
      await this.mexcClient.getOrder({
        symbol,
        orderId: exchangeOrderId,
      });

    const exchangeStatus =
      this.normalizeStatus(response);

    const localStatus = String(
      exchangeOrder.status ?? "",
    ).toUpperCase();

    this.exchangeOrderRepository.updateFinalResponse(
      exchangeOrder.id,
      response,
    );

    const statusMatches =
      exchangeStatus === localStatus ||
      (
        localStatus === "NEW" &&
        exchangeStatus === "NEW"
      ) ||
      (
        localStatus === "ORDER_PLACED" &&
        [
          "NEW",
          "ORDER_PLACED",
          "PARTIALLY_FILLED",
        ].includes(exchangeStatus)
      );

    if (
      exchangeStatus === "FILLED" &&
      localStatus !== "FILLED"
    ) {
      if (!this.exchangeOrderFillMonitorService) {
        throw new Error(
          "Exchange order fill monitor service is required for fill recovery",
        );
      }

      const recovery =
        await this.exchangeOrderFillMonitorService.processOrder({
          exchangeOrder,
          symbol,
        });

      const recoveredOrder =
        this.exchangeOrderRepository.findById(
          exchangeOrder.id,
        );

      return {
        exchangeOrderId,
        symbol,
        localStatus,
        exchangeStatus,
        match: false,
        status: "FILL_RECOVERED",
        recovery,
        localStatusAfterRecovery:
          recoveredOrder?.status ?? null,
        fillProcessingStatus:
          recoveredOrder?.fill_processing_status ?? null,
        response,
      };
    }

    return {
      exchangeOrderId,
      symbol,
      localStatus,
      exchangeStatus,
      match: statusMatches,
      status: statusMatches
        ? "CONSISTENT"
        : "DISCREPANCY",
      response,
    };
  }

  async reconcile() {
    const orders =
      this.exchangeOrderRepository.findActive();

    const results = [];

    for (const exchangeOrder of orders) {
      try {
        const dbAudit =
          this.auditDbConsistency(exchangeOrder);

        const exchangeResult =
          await this.reconcileOrder(exchangeOrder);

        results.push({
          ...exchangeResult,
          dbConsistent: dbAudit.consistent,
          dbIssues: dbAudit.issues,
          fillCount: dbAudit.fillCount,
          status:
            exchangeResult.status ===
              "EXCHANGE_CHECK_FAILED"
              ? exchangeResult.status
              : !dbAudit.consistent
                ? "DB_INCONSISTENCY"
                : exchangeResult.status,
        });
      } catch (error) {
        results.push({
          exchangeOrderId:
            exchangeOrder.exchange_order_id,
          symbol: exchangeOrder.symbol,
          status: "EXCHANGE_CHECK_FAILED",
          match: false,
          error: error.message,
        });
      }
    }

    return {
      checked: orders.length,
      consistent: results.filter(
        (result) => result.status === "CONSISTENT",
      ).length,
      discrepancies: results.filter(
        (result) =>
          result.status === "DISCREPANCY" ||
          result.status === "DB_INCONSISTENCY",
      ).length,
      dbInconsistencies: results.filter(
        (result) =>
          result.status === "DB_INCONSISTENCY",
      ).length,
      recoveredFills: results.filter(
        (result) =>
          result.status === "FILL_RECOVERED",
      ).length,
      failed: results.filter(
        (result) =>
          result.status ===
          "EXCHANGE_CHECK_FAILED",
      ).length,
      results,
    };
  }
}
