export default class ExchangeReconciliationService {
  constructor({
    mexcClient,
    exchangeOrderRepository,
    exchangeOrderFillMonitorService,
  }) {
    this.mexcClient = mexcClient;
    this.exchangeOrderRepository = exchangeOrderRepository;
    this.exchangeOrderFillMonitorService =
      exchangeOrderFillMonitorService;
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

    const response = await this.mexcClient.getOrder({
      symbol,
      orderId: exchangeOrderId,
    });

    const exchangeStatus = this.normalizeStatus(response);
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
        ["NEW", "ORDER_PLACED", "PARTIALLY_FILLED"].includes(
          exchangeStatus,
        )
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
        results.push(
          await this.reconcileOrder(exchangeOrder),
        );
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
        (result) => result.status === "DISCREPANCY",
      ).length,
      recoveredFills: results.filter(
        (result) => result.status === "FILL_RECOVERED",
      ).length,
      failed: results.filter(
        (result) => result.status === "EXCHANGE_CHECK_FAILED",
      ).length,
      results,
    };
  }
}
