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

  calculateTakeProfit(
    averagePrice,
    config = this.tradingConfig,
  ) {
    if (!Number.isFinite(averagePrice) || averagePrice <= 0) {
      throw new Error("Average price must be greater than 0");
    }

    return averagePrice * (1 + config.takeProfit / 100);
  }

  calculateStopLoss(
    initialFillPrice,
    config = this.tradingConfig,
  ) {
    if (!Number.isFinite(initialFillPrice) || initialFillPrice <= 0) {
      throw new Error("Initial fill price must be greater than 0");
    }

    return initialFillPrice * (1 - config.stopLoss / 100);
  }

  async calculateAfterInitialFill({
    symbol,
    initialFill,
    config = this.tradingConfig,
  }) {
    const initialPrice = Number(initialFill.price);
    const position = this.positionCalculator.calculate([{
      side: "BUY",
      quantity: Number(initialFill.quantity),
      price: initialPrice,
    }]);

    const dcaLevels =
      this.dcaCalculator.calculateLevels(
        initialPrice,
        config,
      );
    const rules = await this.symbolRulesService.get(symbol);

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
        price: this.calculateTakeProfit(
          position.averagePrice,
          config,
        ),
        quantity: position.totalQuantity,
      },
      stopLoss: {
        price: this.calculateStopLoss(
          initialPrice,
          config,
        ),
        quantity: position.totalQuantity,
      },
    };
  }

  calculateAfterDcaFill({
    fills,
    config = this.tradingConfig,
  }) {
    const position = this.positionCalculator.calculate(fills);

    return {
      position,
      takeProfit: {
        price: this.calculateTakeProfit(
          position.averagePrice,
          config,
        ),
        quantity: position.totalQuantity,
      },
    };
  }
}
