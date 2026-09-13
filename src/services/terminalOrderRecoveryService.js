import tradingConfig from "../config/trading.config.js";

export default class TerminalOrderRecoveryService {
  constructor({
    tradingCycleRepository,
    dcaOrderRepository,
    exchangeOrderRepository,
    tradingCycleExecutionService,
    cycleLifecycleService,
    duplicateProtectionService,
    dcaOrderManager,
    fillRepository,
  }) {
    this.tradingCycleRepository = tradingCycleRepository;
    this.dcaOrderRepository = dcaOrderRepository;
    this.exchangeOrderRepository = exchangeOrderRepository;
    this.tradingCycleExecutionService =
      tradingCycleExecutionService;
    this.cycleLifecycleService = cycleLifecycleService;
    this.duplicateProtectionService =
      duplicateProtectionService;
    this.dcaOrderManager = dcaOrderManager;
    this.fillRepository = fillRepository;

    const configuredMaxAttempts =
      tradingConfig?.terminalRecovery?.maxAttempts;

    this.maxAttempts =
      Number.isInteger(configuredMaxAttempts) &&
      configuredMaxAttempts > 0
        ? configuredMaxAttempts
        : 5;
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

    const recoveryStatus = String(
      exchangeOrder.recovery_status ?? "PENDING",
    ).toUpperCase();

    if (!this.isTerminal(status)) {
      return {
        status: "SKIPPED",
        exchangeOrderId: exchangeOrder.exchange_order_id,
      };
    }

    if (recoveryStatus === "PROCESSED") {
      return {
        status: "ALREADY_RECOVERED",
        exchangeOrderId: exchangeOrder.exchange_order_id,
      };
    }

    const recoveryAttempts = Number(
      exchangeOrder.recovery_attempts ?? 0,
    );

    if (recoveryAttempts >= this.maxAttempts) {
      this.exchangeOrderRepository.markRecoveryExhausted(
        exchangeOrder.id,
        `Maximum terminal recovery attempts reached: ${this.maxAttempts}`,
      );

      return {
        status: "RECOVERY_EXHAUSTED",
        exchangeOrderId: exchangeOrder.exchange_order_id,
        attempts: recoveryAttempts,
        maxAttempts: this.maxAttempts,
      };
    }

    this.exchangeOrderRepository.markRecoveryProcessing(
      exchangeOrder.id,
    );

    const cycleId = Number(exchangeOrder.trading_cycle_id);
    const symbol = String(exchangeOrder.symbol);
    const side = String(exchangeOrder.side).toUpperCase();

    if (!cycleId || !symbol) {
      this.exchangeOrderRepository.markRecoveryFailed(
        exchangeOrder.id,
        "Invalid terminal exchange order",
      );

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
          this.exchangeOrderRepository.markRecoveryFailed(
            exchangeOrder.id,
            "DCA order not found",
          );

          return {
            status: "DCA_NOT_FOUND",
            exchangeOrderId: exchangeOrder.exchange_order_id,
          };
        }

        this.dcaOrderRepository.updateStatus(
          dcaOrder.id,
          "PENDING",
        );

        if (!this.dcaOrderManager) {
          this.exchangeOrderRepository.markRecoveryFailed(
            exchangeOrder.id,
            "DCA order manager is required for terminal retry",
          );

          return {
            status: "DCA_RETRY_SERVICE_MISSING",
            exchangeOrderId: exchangeOrder.exchange_order_id,
            dcaOrderId: dcaOrder.id,
            cycleId,
          };
        }

        const retryClientOrderId =
          `${exchangeOrder.client_order_id ?? `mxc-c${cycleId}-dca-${dcaOrder.id}`}-retry-${exchangeOrder.exchange_order_id}`;

        const retryResult =
          await this.dcaOrderManager.retryDcaOrder({
            cycleId,
            symbol,
            dcaOrderId: dcaOrder.id,
            clientOrderId: retryClientOrderId,
          });

        const retryOrder =
          this.exchangeOrderRepository.findByClientOrderId(
            retryClientOrderId,
          );

        if (!retryOrder) {
          this.exchangeOrderRepository.markRecoveryFailed(
            exchangeOrder.id,
            "DCA retry was not placed because DCA target was not reached",
          );

          return {
            status: "DCA_RETRY_WAITING",
            exchangeOrderId: exchangeOrder.exchange_order_id,
            dcaOrderId: dcaOrder.id,
            cycleId,
            retryResult,
          };
        }

        this.exchangeOrderRepository.markRecoveryProcessed(
          exchangeOrder.id,
        );

        return {
          status: "DCA_RETRIED",
          exchangeOrderId: exchangeOrder.exchange_order_id,
          dcaOrderId: dcaOrder.id,
          cycleId,
          retryClientOrderId,
          retryExchangeOrderId: retryOrder.exchange_order_id,
          retryResult,
        };
      }

      const cycle =
        this.tradingCycleRepository.findById(cycleId);

      if (!cycle || cycle.status !== "OPEN") {
        this.exchangeOrderRepository.markRecoveryFailed(
          exchangeOrder.id,
          "Initial BUY cycle is not OPEN",
        );

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

      this.exchangeOrderRepository.markRecoveryProcessed(
        exchangeOrder.id,
      );

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
        this.exchangeOrderRepository.markRecoveryFailed(
          exchangeOrder.id,
          "Trading cycle not found",
        );

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

      if (!this.fillRepository) {
        this.exchangeOrderRepository.markRecoveryFailed(
          exchangeOrder.id,
          "Fill repository is required for exit retry",
        );

        return {
          status: "EXIT_RETRY_SERVICE_MISSING",
          exchangeOrderId: exchangeOrder.exchange_order_id,
          cycleId,
        };
      }

      const fills =
        this.fillRepository.findByCycleId(cycleId);

      const oldClientOrderId =
        String(exchangeOrder.client_order_id ?? "");

      const reason =
        oldClientOrderId.includes("-sl")
          ? "STOP_LOSS"
          : "TAKE_PROFIT";

      const retryClientOrderId =
        `${oldClientOrderId || `mxc-c${cycleId}-tp`}-retry-${exchangeOrder.exchange_order_id}`;

      const exitResult =
        await this.cycleLifecycleService.triggerExit({
          cycleId,
          symbol,
          reason,
          fills,
          clientOrderId: retryClientOrderId,
        });

      const retryOrder =
        this.exchangeOrderRepository.findByClientOrderId(
          retryClientOrderId,
        );

      if (!retryOrder) {
        this.exchangeOrderRepository.markRecoveryFailed(
          exchangeOrder.id,
          "Exit retry was not placed",
        );

        return {
          status: "EXIT_RETRY_NOT_PLACED",
          exchangeOrderId: exchangeOrder.exchange_order_id,
          cycleId,
          exitResult,
        };
      }

      this.exchangeOrderRepository.markRecoveryProcessed(
        exchangeOrder.id,
      );

      return {
        status: "EXIT_RETRIED",
        exchangeOrderId: exchangeOrder.exchange_order_id,
        cycleId,
        retryClientOrderId,
        retryExchangeOrderId: retryOrder.exchange_order_id,
        exitResult,
      };
    }

    this.exchangeOrderRepository.markRecoveryFailed(
      exchangeOrder.id,
      `Unsupported order side: ${side}`,
    );

    return {
      status: "UNSUPPORTED_SIDE",
      exchangeOrderId: exchangeOrder.exchange_order_id,
      side,
    };
  }

  async recover() {
    const terminalOrders =
      this.exchangeOrderRepository.findRecoverableTerminalOrders?.() ?? [];

    const results = [];

    for (const exchangeOrder of terminalOrders) {
      try {
        results.push(
          await this.recoverOrder(exchangeOrder),
        );
      } catch (error) {
        try {
          this.exchangeOrderRepository.markRecoveryFailed(
            exchangeOrder.id,
            error.message,
          );
        } catch {}

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
      dcaRetried: results.filter(
        (r) => r.status === "DCA_RETRIED",
      ).length,
      dcaWaiting: results.filter(
        (r) => r.status === "DCA_RETRY_WAITING",
      ).length,
      exitsRetried: results.filter(
        (r) => r.status === "EXIT_RETRIED",
      ).length,
      exitRetryFailed: results.filter(
        (r) => r.status === "EXIT_RETRY_NOT_PLACED",
      ).length,
      failed: results.filter(
        (r) => r.status === "RECOVERY_FAILED",
      ).length,
      exhausted: results.filter(
        (r) => r.status === "RECOVERY_EXHAUSTED",
      ).length,
      maxAttempts: this.maxAttempts,
      results,
    };
  }
}
