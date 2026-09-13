export default class ExchangeReconciliationRunner {
  constructor({
    exchangeReconciliationService,
    intervalMs = 60000,
  }) {
    this.exchangeReconciliationService =
      exchangeReconciliationService;

    this.intervalMs = intervalMs;
    this.timer = null;
    this.running = false;
    this.reconciling = false;
  }

  async runOnce() {
    if (this.reconciling) {
      return {
        skipped: true,
        reason: "RECONCILIATION_ALREADY_RUNNING",
      };
    }

    this.reconciling = true;

    try {
      return await this.exchangeReconciliationService.reconcile();
    } finally {
      this.reconciling = false;
    }
  }

  start() {
    if (this.timer) {
      return false;
    }

    this.timer = setInterval(() => {
      void this.runOnce().catch((error) => {
        console.error(
          "[Reconciliation] Failed:",
          error.message,
        );
      });
    }, this.intervalMs);

    return true;
  }

  stop() {
    if (!this.timer) {
      return false;
    }

    clearInterval(this.timer);
    this.timer = null;

    return true;
  }

  isRunning() {
    return Boolean(this.timer);
  }
}
