export default class ExchangeOrderPollingRunner {
  constructor({
    exchangeOrderRepository,
    exchangeOrderFillMonitorService,
    intervalMs = 5000,
  }) {
    if (!exchangeOrderRepository) {
      throw new Error("Exchange order repository is required");
    }

    if (!exchangeOrderFillMonitorService) {
      throw new Error("Exchange order fill monitor service is required");
    }

    if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
      throw new Error("Polling interval must be a positive integer");
    }

    this.exchangeOrderRepository = exchangeOrderRepository;
    this.exchangeOrderFillMonitorService =
      exchangeOrderFillMonitorService;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.running = false;
    this.processing = false;
  }

  async tick() {
    if (this.processing) {
      return {
        checked: 0,
        filled: 0,
        failed: 0,
        skipped: true,
        reason: "PREVIOUS_TICK_RUNNING",
      };
    }

    this.processing = true;

    try {
      const orders =
        this.exchangeOrderRepository.findActive();

      let checked = 0;
      let filled = 0;
      let failed = 0;

      for (const exchangeOrder of orders) {
        try {
          const result =
            await this.exchangeOrderFillMonitorService.processOrder({
              exchangeOrder,
              symbol: exchangeOrder.symbol,
            });

          checked += 1;

          if (result.processed) {
            filled += 1;
          }
        } catch (error) {
          failed += 1;

          console.error(
            `[OrderPolling] Order ${exchangeOrder.id} failed:`,
            error.message,
          );
        }
      }

      return {
        checked,
        filled,
        failed,
      };
    } finally {
      this.processing = false;
    }
  }

  start() {
    if (this.running) {
      return false;
    }

    this.running = true;

    this.tick().catch((error) => {
      console.error(
        "[OrderPolling] Initial tick failed:",
        error.message,
      );
    });

    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        console.error(
          "[OrderPolling] Tick failed:",
          error.message,
        );
      });
    }, this.intervalMs);

    return true;
  }

  stop() {
    if (!this.running) {
      return false;
    }

    clearInterval(this.timer);
    this.timer = null;
    this.running = false;

    return true;
  }

  isRunning() {
    return this.running;
  }
}
