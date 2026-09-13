export default class OrderIntentRecoveryRunner {
  constructor({
    orderIntentRecoveryService,
    intervalMs = 60000,
  }) {
    if (!orderIntentRecoveryService) {
      throw new Error(
        "Order intent recovery service is required",
      );
    }

    if (
      !Number.isInteger(intervalMs) ||
      intervalMs <= 0
    ) {
      throw new Error(
        "Valid order intent recovery interval is required",
      );
    }

    this.orderIntentRecoveryService =
      orderIntentRecoveryService;

    this.intervalMs = intervalMs;
    this.timer = null;
    this.recovering = false;
  }

  async runOnce() {
    if (this.recovering) {
      return {
        skipped: true,
        reason:
          "ORDER_INTENT_RECOVERY_ALREADY_RUNNING",
      };
    }

    this.recovering = true;

    try {
      return await this.orderIntentRecoveryService.recover();
    } finally {
      this.recovering = false;
    }
  }

  start() {
    if (this.timer) {
      return false;
    }

    this.timer = setInterval(() => {
      void this.runOnce().catch((error) => {
        console.error(
          "[OrderIntentRecovery] Failed:",
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
