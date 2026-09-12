export default class DcaOrderManager {
  constructor({
    dcaOrderRepository,
    dcaCalculator,
    quantityCalculator,
    makerOrderEngine,
    marketPriceService,
    symbolRulesService,
    exchangeOrderRepository,
    duplicateProtectionService,
  }) {
    this.dcaOrderRepository = dcaOrderRepository;
    this.dcaCalculator = dcaCalculator;
    this.quantityCalculator = quantityCalculator;
    this.makerOrderEngine = makerOrderEngine;
    this.marketPriceService = marketPriceService;
    this.symbolRulesService = symbolRulesService;
    this.exchangeOrderRepository = exchangeOrderRepository;
    this.duplicateProtectionService = duplicateProtectionService;
  }

  async createDcaOrders({ cycleId, symbol, initialPrice }) {
    if (!Number.isInteger(cycleId) || cycleId <= 0) {
      throw new Error("Valid cycleId is required");
    }

    if (!symbol) {
      throw new Error("Symbol is required");
    }

    const levels = this.dcaCalculator.calculateLevels(initialPrice);
    const rules = await this.symbolRulesService.get(symbol);

    return levels.map((level) => {
      const quantity = this.quantityCalculator.calculateBuyQuantity(
        level.targetPrice,
        rules,
      );

      return this.dcaOrderRepository.create({
        tradingCycleId: cycleId,
        orderNumber: level.orderNumber,
        orderType: "LIMIT_MAKER",
        targetPrice: level.targetPrice,
        quantity,
        status: "PENDING",
      });
    });
  }

  async processPendingOrders({ cycleId, symbol }) {
    const pendingOrders =
      await this.dcaOrderRepository.findPendingByCycleId(cycleId);

    if (!pendingOrders.length) {
      return [];
    }

    const market = await this.marketPriceService.get(symbol);
    const results = [];

    for (const dcaOrder of pendingOrders) {
      if (market.price > dcaOrder.target_price) {
        results.push({
          dcaOrderId: dcaOrder.id,
          status: "WAITING",
          reason: "Price has not reached DCA target",
        });
        continue;
      }

      try {
        const clientOrderId =
          this.duplicateProtectionService.createClientOrderId({
            cycleId,
            kind: "dca",
            id: dcaOrder.id,
          });

        const placement =
          await this.duplicateProtectionService.placeBuy({
            tradingCycleId: cycleId,
            dcaOrderId: dcaOrder.id,
            symbol,
            quantity: dcaOrder.quantity,
            price: dcaOrder.target_price,
            bestAsk: market.askPrice,
            clientOrderId,
          });

        const exchangeOrder = placement.exchangeOrder;

        await this.dcaOrderRepository.updateStatus(
          dcaOrder.id,
          "ORDER_PLACED",
        );

        results.push({
          dcaOrderId: dcaOrder.id,
          status: "ORDER_PLACED",
          exchangeOrder,
        });
      } catch (error) {
        results.push({
          dcaOrderId: dcaOrder.id,
          status: "FAILED",
          reason: error.message,
        });
      }
    }

    return results;
  }
}
