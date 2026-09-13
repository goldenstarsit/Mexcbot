export default class DcaCalculator {
  constructor(tradingConfig) {
    this.tradingConfig = tradingConfig;
  }

  calculateLevels(initialPrice, config = this.tradingConfig) {
    if (!Number.isFinite(initialPrice) || initialPrice <= 0) {
      throw new Error("Initial price must be greater than 0");
    }

    const levels = config.dca.levels;
    const result = [];

    for (let orderNumber = 1; orderNumber <= levels; orderNumber += 1) {
      const dropPercent = (orderNumber * (orderNumber + 1)) / 2;
      const targetPrice = initialPrice * (1 - dropPercent / 100);

      if (targetPrice <= 0) {
        throw new Error(`Invalid DCA target price at level ${orderNumber}`);
      }

      result.push({
        orderNumber: orderNumber + 1,
        dcaLevel: orderNumber,
        dropPercent,
        targetPrice,
      });
    }

    return result;
  }
}
