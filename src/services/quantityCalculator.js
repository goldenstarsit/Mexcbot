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

  calculateSellQuantity(quantity, rules) {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("Quantity must be greater than 0");
    }

    if (!rules || !Number.isFinite(rules.minQty) || rules.minQty <= 0) {
      throw new Error("Valid minQty is required");
    }

    const stepSize = Number(rules.stepSize ?? rules.minQty);

    if (!Number.isFinite(stepSize) || stepSize <= 0) {
      throw new Error("Valid stepSize is required");
    }

    const steps = Math.floor(quantity / stepSize + 1e-8);
    const normalizedQuantity = steps * stepSize;

    const result = this.normalize(normalizedQuantity, stepSize);

    if (result < rules.minQty) {
      throw new Error("Normalized SELL quantity is below minQty");
    }

    return result;
  }

  normalize(quantity, stepSize) {
    const stepString = stepSize.toString();
    const exponentMatch = stepString.match(/e-([0-9]+)$/i);

    const decimals = exponentMatch
      ? Number(exponentMatch[1])
      : Math.max(
          0,
          (stepString.split(".")[1] || "").length,
        );

    return Number(quantity.toFixed(decimals));
  }
}
