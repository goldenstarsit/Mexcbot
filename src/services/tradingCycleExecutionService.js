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
    duplicateProtectionService,
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
    this.duplicateProtectionService = duplicateProtectionService;
    this.positionProtectionService = positionProtectionService;
  }

  async triggerInitialOrder({
    cycleId,
    symbol,
    clientOrderId = null,
  }) {
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

    const resolvedClientOrderId =
      clientOrderId ??
      this.duplicateProtectionService.createClientOrderId({
        cycleId,
        kind: "initial",
      });

    const placement =
      await this.duplicateProtectionService.placeBuy({
        tradingCycleId: cycleId,
        symbol,
        quantity,
        price: market.bidPrice,
        bestAsk: market.askPrice,
        clientOrderId: resolvedClientOrderId,
      });

    const exchangeOrder = placement.exchangeOrder;

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

    const cycle =
      await this.tradingCycleRepository.findById(cycleId);

    const configSnapshot =
      cycle?.config_snapshot_json
        ? JSON.parse(cycle.config_snapshot_json)
        : null;

    if (!configSnapshot?.config) {
      throw new Error(
        `Configuration snapshot is missing for cycle ${cycleId}`,
      );
    }

    const protection =
      await this.positionProtectionService.calculateAfterInitialFill({
        symbol,
        initialFill: {
          price: Number(fill.price),
          quantity: Number(fill.quantity),
        },
        config: configSnapshot.config,
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

    const updatedCycle =
      this.tradingCycleRepository.updatePerformanceSummary(cycleId);

    return {
      cycleId,
      symbol,
      position: protection.position,
      dcaOrders,
      takeProfit: protection.takeProfit,
      stopLoss: protection.stopLoss,
      stopLossCalculated: true,
      cycleSummary: updatedCycle,
    };
  }

  processDcaFill({
    cycleId,
    fills,
  }) {
    if (!Number.isInteger(cycleId) || cycleId <= 0) {
      throw new Error("Valid cycleId is required");
    }

    const cycle =
      this.tradingCycleRepository.findById(cycleId);

    const configSnapshot =
      cycle?.config_snapshot_json
        ? JSON.parse(cycle.config_snapshot_json)
        : null;

    if (!configSnapshot?.config) {
      throw new Error(
        `Configuration snapshot is missing for cycle ${cycleId}`,
      );
    }

    const result =
      this.positionProtectionService.calculateAfterDcaFill({
        fills,
        config: configSnapshot.config,
      });

    this.tradingCycleRepository.updatePerformanceSummary(cycleId);

    return result;
  }
}
