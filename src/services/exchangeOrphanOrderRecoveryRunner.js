export default class ExchangeOrphanOrderRecoveryRunner {
  constructor({
    exchangeOrphanOrderRecoveryService,
    intervalMs = 60000,
  }) {
    if (!exchangeOrphanOrderRecoveryService) {
      throw new Error(
        "Exchange orphan order recovery service is required",
      );
    }

    if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
      throw new Error(
        "Valid exchange orphan order recovery interval is required",
      );
    }

    this.exchangeOrphanOrderRecoveryService =
      exchangeOrphanOrderRecoveryService;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.recovering = false;
  }

  async runOnce() {
    if (this.recovering) {
      return {
        skipped: true,
        reason: "EXCHANGE_ORPHAN_RECOVERY_ALREADY_RUNNING",
      };
    }

    this.recovering = true;

    try {
      return await this.exchangeOrphanOrderRecoveryService.recover();
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
          "[OrphanRecovery] Failed:",
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
