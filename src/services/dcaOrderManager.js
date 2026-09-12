export default class DcaOrderManager {
  constructor({
    dcaOrderRepository,
    dcaCalculator,
    quantityCalculator,
    makerOrderEngine,
    marketPriceService,
    symbolRulesService,
    exchangeOrderRepository,
  }) {
    this.dcaOrderRepository = dcaOrderRepository;
    this.dcaCalculator = dcaCalculator;
    this.quantityCalculator = quantityCalculator;
    this.makerOrderEngine = makerOrderEngine;
    this.marketPriceService = marketPriceService;
    this.symbolRulesService = symbolRulesService;
    this.exchangeOrderRepository = exchangeOrderRepository;
  }

  async createDcaOrders({ cycleId, symbol, initialPrice }) {
    if (!Number.isInteger(cycleId) || cycleId <= 0) {
      throw new Error("Valid cycleId is required");
    }

    if (!symbol) {
      throw new Error("Symbol is required");
    }

    const levels = this.dcaCalculator.calculateLevels(initialPrice);
    const rules = await this.symbolRulesService.getRules(symbol);

    return levels.map((level) => {
      const quantity = this.quantityCalculator.calculateBuyQuantity(
        level.targetPrice,
        rules,
      );

      return this.dcaOrderRepository.create({
        cycleId,
        level: level.dcaLevel,
        orderNumber: level.orderNumber,
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

    const market = await this.marketPriceService.getMarketPrice(symbol);
    const results = [];

    for (const dcaOrder of pendingOrders) {
      if (market.price > dcaOrder.targetPrice) {
        results.push({
          dcaOrderId: dcaOrder.id,
          status: "WAITING",
          reason: "Price has not reached DCA target",
        });
        continue;
      }

      try {
        const order = await this.makerOrderEngine.placeBuy({
          symbol,
          quantity: dcaOrder.quantity,
          price: dcaOrder.targetPrice,
          bestAsk: market.askPrice,
        });

        const exchangeOrderId = String(
          order.orderId ?? order.order_id ?? order.id ?? "",
        );

        if (!exchangeOrderId) {
          throw new Error("MEXC exchange order ID is missing");
        }

        const exchangeOrder =
          await this.exchangeOrderRepository.create({
            tradingCycleId: cycleId,
            dcaOrderId: dcaOrder.id,
            symbol,
            exchangeOrderId,
            side: "BUY",
            orderType: "LIMIT_MAKER",
            price: dcaOrder.targetPrice,
            quantity: dcaOrder.quantity,
            status: "NEW",
          });

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
