export default class DcaProgressDashboardService {
  constructor({
    tradingCycleRepository,
    dcaOrderRepository,
    marketPriceService,
  }) {
    this.tradingCycleRepository = tradingCycleRepository;
    this.dcaOrderRepository = dcaOrderRepository;
    this.marketPriceService = marketPriceService;
  }

  async getProgress({ symbol = null } = {}) {
    const cycles = symbol
      ? [this.tradingCycleRepository.findOpenBySymbol(symbol)].filter(Boolean)
      : this.tradingCycleRepository.findByStatus("OPEN");

    return Promise.all(cycles.map((cycle) => this.buildProgress(cycle)));
  }

  async buildProgress(cycle) {
    const orders = this.dcaOrderRepository.findByCycleId(cycle.id);
    const market = await this.marketPriceService.get(cycle.symbol);

    const totalLevels = orders.length;

    const counts = {
      pending: orders.filter((order) => order.status === "PENDING").length,
      placed: orders.filter((order) =>
        ["ORDER_PLACED", "PARTIALLY_FILLED"].includes(order.status),
      ).length,
      triggered: orders.filter((order) =>
        ["TRIGGERED", "FILLED"].includes(order.status),
      ).length,
    };

    const completedOrders = orders.filter((order) =>
      ["TRIGGERED", "FILLED"].includes(order.status),
    );

    const nextOrder =
      orders.find((order) =>
        ["PENDING"].includes(order.status),
      ) ?? null;

    const progressPercent =
      totalLevels > 0
        ? (completedOrders.length / totalLevels) * 100
        : 0;

    return {
      cycleId: cycle.id,
      symbol: cycle.symbol,
      cycleNumber: cycle.cycle_number,
      status: cycle.status,
      currentPrice: market.price,
      bidPrice: market.bidPrice,
      askPrice: market.askPrice,
      totalLevels,
      completedLevels: completedOrders.length,
      remainingLevels: Math.max(totalLevels - completedOrders.length, 0),
      progressPercent,
      counts,
      nextDca: nextOrder
        ? {
            id: nextOrder.id,
            orderNumber: nextOrder.order_number,
            dcaLevel: Math.max(Number(nextOrder.order_number) - 1, 1),
            targetPrice: Number(nextOrder.target_price),
            quantity:
              nextOrder.quantity === null
                ? null
                : Number(nextOrder.quantity),
            status: nextOrder.status,
            distancePercent:
              ((market.price - Number(nextOrder.target_price)) /
                market.price) *
              100,
            reached:
              market.price <= Number(nextOrder.target_price),
          }
        : null,
      orders: orders.map((order) => ({
        id: order.id,
        orderNumber: order.order_number,
        dcaLevel: Math.max(Number(order.order_number) - 1, 1),
        targetPrice: Number(order.target_price),
        quantity:
          order.quantity === null ? null : Number(order.quantity),
        status: order.status,
        triggeredAt: order.triggered_at,
        reached: market.price <= Number(order.target_price),
      })),
    };
  }
}
