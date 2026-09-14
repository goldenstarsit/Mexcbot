export default class TradingCapitalGuard {
  constructor({ minimumFreeUsdt = 1 } = {}) {
    if (
      !Number.isFinite(minimumFreeUsdt) ||
      minimumFreeUsdt <= 0
    ) {
      throw new Error(
        "Minimum free USDT must be greater than 0",
      );
    }

    this.minimumFreeUsdt = minimumFreeUsdt;
  }

  validateFreeUsdt(freeUsdt, requiredUsdt = this.minimumFreeUsdt) {
    const available = Number(freeUsdt);
    const required = Number(requiredUsdt);

    if (!Number.isFinite(available) || available < 0) {
      throw new Error("Valid free USDT balance is required");
    }

    if (!Number.isFinite(required) || required <= 0) {
      throw new Error("Required USDT amount must be greater than 0");
    }

    if (available < required) {
      return {
        allowed: false,
        availableUsdt: available,
        requiredUsdt: required,
        shortfallUsdt: required - available,
        reason: "INSUFFICIENT_FREE_USDT",
      };
    }

    return {
      allowed: true,
      availableUsdt: available,
      requiredUsdt: required,
      shortfallUsdt: 0,
      reason: null,
    };
  }

  canPlaceBuy(freeUsdt, requiredUsdt = this.minimumFreeUsdt) {
    return this.validateFreeUsdt(freeUsdt, requiredUsdt);
  }
}
