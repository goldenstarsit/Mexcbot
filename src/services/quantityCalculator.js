export default class QuantityCalculator {
  constructor(minNotional = 1) {
    if (!Number.isFinite(minNotional) || minNotional <= 0) {
      throw new Error("Minimum notional must be greater than 0");
    }

    this.minNotional = minNotional;
  }

  calculateBuyQuantity(price, rules) {
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("Price must be greater than 0");
    }

    if (!rules || !Number.isFinite(rules.minQty) || rules.minQty <= 0) {
      throw new Error("Valid minQty is required");
    }

    const stepSize = Number(rules.stepSize ?? rules.minQty);

    if (!Number.isFinite(stepSize) || stepSize <= 0) {
      throw new Error("Valid stepSize is required");
    }

    const requiredNotional = Math.max(
      this.minNotional,
      Number(rules.minNotional ?? 0),
    );

    const rawQuantity = requiredNotional / price;
    const steps = Math.ceil(rawQuantity / stepSize);
    const quantity = Math.max(
      rules.minQty,
      steps * stepSize,
    );

    return this.normalize(quantity, stepSize);
  }

  normalize(quantity, stepSize) {
    const decimals = Math.max(
      0,
      (stepSize.toString().split(".")[1] || "").length,
    );

    return Number(quantity.toFixed(decimals));
  }
}
