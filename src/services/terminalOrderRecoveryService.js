export default class TerminalOrderRecoveryService {
  constructor({
    tradingCycleRepository,
    dcaOrderRepository,
    exchangeOrderRepository,
    tradingCycleExecutionService,
    cycleLifecycleService,
    duplicateProtectionService,
  }) {
    this.tradingCycleRepository = tradingCycleRepository;
    this.dcaOrderRepository = dcaOrderRepository;
    this.exchangeOrderRepository = exchangeOrderRepository;
    this.tradingCycleExecutionService =
      tradingCycleExecutionService;
    this.cycleLifecycleService = cycleLifecycleService;
    this.duplicateProtectionService =
      duplicateProtectionService;
  }

  isTerminal(status) {
    return [
      "CANCELED",
      "CANCELLED",
      "REJECTED",
      "EXPIRED",
    ].includes(String(status ?? "").toUpperCase());
  }

  nextClientOrderId(base, exchangeOrderId) {
    return `${base}-retry-${exchangeOrderId}`;
  }

  async recoverOrder(exchangeOrder) {
    const status = String(
      exchangeOrder.status ?? "",
    ).toUpperCase();

    if (!this.isTerminal(status)) {
      return {
        status: "SKIPPED",
        exchangeOrderId: exchangeOrder.exchange_order_id,
      };
    }

    const cycleId = Number(exchangeOrder.trading_cycle_id);
    const symbol = String(exchangeOrder.symbol);
    const side = String(exchangeOrder.side).toUpperCase();

    if (!cycleId || !symbol) {
      return {
        status: "INVALID_ORDER",
        exchangeOrderId: exchangeOrder.exchange_order_id,
      };
    }

    if (side === "BUY") {
      if (exchangeOrder.dca_order_id !== null) {
        const dcaOrder =
          this.dcaOrderRepository.findById(
            exchangeOrder.dca_order_id,
          );

        if (!dcaOrder) {
          return {
            status: "DCA_NOT_FOUND",
            exchangeOrderId: exchangeOrder.exchange_order_id,
          };
        }

        this.dcaOrderRepository.updateStatus(
          dcaOrder.id,
          "PENDING",
        );

        return {
          status: "DCA_RESET_TO_PENDING",
          exchangeOrderId: exchangeOrder.exchange_order_id,
          dcaOrderId: dcaOrder.id,
          cycleId,
        };
      }

      const cycle =
        this.tradingCycleRepository.findById(cycleId);

      if (!cycle || cycle.status !== "OPEN") {
        return {
          status: "INITIAL_BUY_CYCLE_NOT_OPEN",
          exchangeOrderId: exchangeOrder.exchange_order_id,
          cycleId,
        };
      }

      const clientOrderId =
        this.duplicateProtectionService.createClientOrderId({
          cycleId,
          kind: "initial",
        }) +
        `-retry-${exchangeOrder.exchange_order_id}`;

      const initialOrder =
        await this.tradingCycleExecutionService.triggerInitialOrder({
          cycleId,
          symbol,
          clientOrderId,
        });

      return {
        status: "INITIAL_BUY_RETRIED",
        exchangeOrderId: exchangeOrder.exchange_order_id,
        cycleId,
        initialOrder,
      };
    }

    if (side === "SELL") {
      const cycle =
        this.tradingCycleRepository.findById(cycleId);

      if (!cycle) {
        return {
          status: "CYCLE_NOT_FOUND",
          exchangeOrderId: exchangeOrder.exchange_order_id,
          cycleId,
        };
      }

      if (cycle.status === "EXIT_PENDING") {
        this.tradingCycleRepository.updateStatus(
          cycleId,
          "OPEN",
        );
      }

      return {
        status: "EXIT_RESET_TO_OPEN",
        exchangeOrderId: exchangeOrder.exchange_order_id,
        cycleId,
      };
    }

    return {
      status: "UNSUPPORTED_SIDE",
      exchangeOrderId: exchangeOrder.exchange_order_id,
      side,
    };
  }

  async recover() {
    const terminalOrders =
      this.exchangeOrderRepository.findTerminalOrders?.() ?? [];

    const results = [];

    for (const exchangeOrder of terminalOrders) {
      try {
        results.push(
          await this.recoverOrder(exchangeOrder),
        );
      } catch (error) {
        results.push({
          status: "RECOVERY_FAILED",
          exchangeOrderId:
            exchangeOrder.exchange_order_id,
          error: error.message,
        });
      }
    }

    return {
      checked: terminalOrders.length,
      initialBuyRetried: results.filter(
        (r) => r.status === "INITIAL_BUY_RETRIED",
      ).length,
      dcaReset: results.filter(
        (r) => r.status === "DCA_RESET_TO_PENDING",
      ).length,
      exitsReset: results.filter(
        (r) => r.status === "EXIT_RESET_TO_OPEN",
      ).length,
      failed: results.filter(
        (r) => r.status === "RECOVERY_FAILED",
      ).length,
      results,
    };
  }
}
