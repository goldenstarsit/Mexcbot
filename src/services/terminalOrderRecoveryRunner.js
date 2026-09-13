export default class TerminalOrderRecoveryRunner {
  constructor({
    terminalOrderRecoveryService,
    intervalMs = 60000,
  }) {
    if (!terminalOrderRecoveryService) {
      throw new Error("Terminal order recovery service is required");
    }

    if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
      throw new Error("Valid recovery interval is required");
    }

    this.terminalOrderRecoveryService =
      terminalOrderRecoveryService;

    this.intervalMs = intervalMs;
    this.timer = null;
    this.recovering = false;
  }

  async runOnce() {
    if (this.recovering) {
      return {
        skipped: true,
        reason: "TERMINAL_RECOVERY_ALREADY_RUNNING",
      };
    }

    this.recovering = true;

    try {
      return await this.terminalOrderRecoveryService.recover();
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
          "[TerminalRecovery] Failed:",
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
