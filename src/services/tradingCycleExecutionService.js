export default class TradingCycleExecutionService {
  constructor({
    tradingCycleRepository,
    dcaOrderRepository,
    exchangeOrderRepository,
    fillRepository,
    marketPriceService,
    symbolRulesService,
    quantityCalculator,
    makerOrderEngine,
    positionProtectionService,
  }) {
    this.tradingCycleRepository = tradingCycleRepository;
    this.dcaOrderRepository = dcaOrderRepository;
    this.exchangeOrderRepository = exchangeOrderRepository;
    this.fillRepository = fillRepository;
    this.marketPriceService = marketPriceService;
    this.symbolRulesService = symbolRulesService;
    this.quantityCalculator = quantityCalculator;
    this.makerOrderEngine = makerOrderEngine;
    this.positionProtectionService = positionProtectionService;
  }

  async triggerInitialOrder({ cycleId, symbol }) {
    if (!Number.isInteger(cycleId) || cycleId <= 0) {
      throw new Error("Valid cycleId is required");
    }

    if (!symbol) {
      throw new Error("Symbol is required");
    }

    const market = await this.marketPriceService.get(symbol);

    const rules = await this.symbolRulesService.get(symbol);

    const quantity = this.quantityCalculator.calculateBuyQuantity(
      market.bidPrice,
      rules,
    );

    const order = await this.makerOrderEngine.placeBuy({
      symbol,
      quantity,
      price: market.bidPrice,
      bestAsk: market.askPrice,
    });

    const exchangeOrder = await this.exchangeOrderRepository.create({
      tradingCycleId: cycleId,
      symbol,
      exchangeOrderId: String(
        order.orderId ?? order.order_id ?? order.id ?? "",
      ),
      side: "BUY",
      orderType: "LIMIT_MAKER",
      price: market.bidPrice,
      quantity,
      status: "NEW",
    });

    return {
      cycleId,
      symbol,
      quantity,
      price: market.bidPrice,
      exchangeOrder,
    };
  }

  async processInitialFill({
    cycleId,
    symbol,
    fill,
  }) {
    if (!fill || !Number.isFinite(Number(fill.price))) {
      throw new Error("Valid initial fill is required");
    }

    const protection =
      await this.positionProtectionService.calculateAfterInitialFill({
        symbol,
        initialFill: {
          price: Number(fill.price),
          quantity: Number(fill.quantity),
        },
      });

    const dcaOrders = [];

    for (const dca of protection.dcaOrders) {
      const record = await this.dcaOrderRepository.create({
        tradingCycleId: cycleId,
        orderNumber: dca.orderNumber,
        orderType: "LIMIT_MAKER",
        targetPrice: dca.targetPrice,
        quantity: dca.quantity,
        status: "PENDING",
      });

      dcaOrders.push(record);
    }

    return {
      cycleId,
      symbol,
      position: protection.position,
      dcaOrders,
      takeProfit: protection.takeProfit,
      stopLoss: protection.stopLoss,
      stopLossCalculated: true,
    };
  }

  processDcaFill({
    cycleId,
    fills,
  }) {
    if (!Number.isInteger(cycleId) || cycleId <= 0) {
      throw new Error("Valid cycleId is required");
    }

    return this.positionProtectionService.calculateAfterDcaFill({
      fills,
    });
  }
}
