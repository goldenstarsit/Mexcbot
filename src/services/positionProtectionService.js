export default class PositionProtectionService {
  constructor({
    positionCalculator,
    dcaCalculator,
    quantityCalculator,
    symbolRulesService,
    tradingConfig,
  }) {
    this.positionCalculator = positionCalculator;
    this.dcaCalculator = dcaCalculator;
    this.quantityCalculator = quantityCalculator;
    this.symbolRulesService = symbolRulesService;
    this.tradingConfig = tradingConfig;
  }

  calculateTakeProfit(averagePrice) {
    if (!Number.isFinite(averagePrice) || averagePrice <= 0) {
      throw new Error("Average price must be greater than 0");
    }

    return averagePrice * (1 + this.tradingConfig.takeProfit / 100);
  }

  calculateStopLoss(initialFillPrice) {
    if (!Number.isFinite(initialFillPrice) || initialFillPrice <= 0) {
      throw new Error("Initial fill price must be greater than 0");
    }

    return initialFillPrice * (1 - this.tradingConfig.stopLoss / 100);
  }

  async calculateAfterInitialFill({
    symbol,
    initialFill,
  }) {
    const initialPrice = Number(initialFill.price);
    const position = this.positionCalculator.calculate([{
      side: "BUY",
      quantity: Number(initialFill.quantity),
      price: initialPrice,
    }]);

    const dcaLevels = this.dcaCalculator.calculateLevels(initialPrice);
    const rules = await this.symbolRulesService.getRules(symbol);

    const dcaOrders = dcaLevels.map((level) => ({
      orderNumber: level.orderNumber,
      dcaLevel: level.dcaLevel,
      dropPercent: level.dropPercent,
      targetPrice: level.targetPrice,
      quantity: this.quantityCalculator.calculateBuyQuantity(
        level.targetPrice,
        rules,
      ),
    }));

    return {
      position,
      dcaOrders,
      takeProfit: {
        price: this.calculateTakeProfit(position.averagePrice),
        quantity: position.totalQuantity,
      },
      stopLoss: {
        price: this.calculateStopLoss(initialPrice),
        quantity: position.totalQuantity,
      },
    };
  }

  calculateAfterDcaFill({
    fills,
  }) {
    const position = this.positionCalculator.calculate(fills);

    return {
      position,
      takeProfit: {
        price: this.calculateTakeProfit(position.averagePrice),
        quantity: position.totalQuantity,
      },
    };
  }
}
