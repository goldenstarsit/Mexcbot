export default class PositionCalculator {
  calculate(fills = []) {
    if (!Array.isArray(fills)) {
      throw new Error("Fills must be an array");
    }

    let totalQuantity = 0;
    let totalCost = 0;

    for (const fill of fills) {
      if (fill.side !== "BUY") {
        continue;
      }

      const quantity = Number(fill.quantity);
      const price = Number(fill.price);

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("BUY fill quantity must be greater than 0");
      }

      if (!Number.isFinite(price) || price <= 0) {
        throw new Error("BUY fill price must be greater than 0");
      }

      totalQuantity += quantity;
      totalCost += quantity * price;
    }

    const averagePrice =
      totalQuantity > 0 ? totalCost / totalQuantity : 0;

    return {
      totalQuantity,
      totalCost,
      averagePrice,
    };
  }
}
