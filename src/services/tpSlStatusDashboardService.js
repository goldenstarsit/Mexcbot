export default class TpSlStatusDashboardService {
  constructor({
    tradingCycleRepository,
    fillRepository,
    exchangeOrderRepository,
    positionCalculator,
    positionProtectionService,
  }) {
    this.tradingCycleRepository = tradingCycleRepository;
    this.fillRepository = fillRepository;
    this.exchangeOrderRepository = exchangeOrderRepository;
    this.positionCalculator = positionCalculator;
    this.positionProtectionService = positionProtectionService;
  }

  getStatus({ symbol = null } = {}) {
    const cycles = symbol
      ? [this.tradingCycleRepository.findOpenBySymbol(symbol)].filter(Boolean)
      : this.tradingCycleRepository.findByStatus("OPEN");

    return cycles.map((cycle) => this.buildStatus(cycle));
  }

  buildStatus(cycle) {
    const fills = this.fillRepository.findByCycleId(cycle.id);
    const buyFills = fills.filter(
      (fill) => String(fill.side).toUpperCase() === "BUY",
    );

    const position = this.positionCalculator.calculate(buyFills);

    let configSnapshot = null;
    try {
      configSnapshot = cycle.config_snapshot_json
        ? JSON.parse(cycle.config_snapshot_json)
        : null;
    } catch {
      configSnapshot = null;
    }

    const config = configSnapshot?.config ?? null;

    let takeProfitPrice = null;
    let stopLossPrice = null;

    if (position.totalQuantity > 0 && config) {
      takeProfitPrice =
        this.positionProtectionService.calculateTakeProfit(
          position.averagePrice,
          config,
        );

      if (buyFills[0]) {
        stopLossPrice =
          this.positionProtectionService.calculateStopLoss(
            Number(buyFills[0].price),
            config,
          );
      }
    }

    const orders = this.exchangeOrderRepository.findByCycleId(cycle.id);

    const sellOrders = orders.filter(
      (order) => String(order.side).toUpperCase() === "SELL",
    );

    const tpOrder =
      sellOrders.find((order) =>
        String(order.client_order_id ?? "").includes("-tp"),
      ) ?? null;

    const slOrder =
      sellOrders.find((order) =>
        String(order.client_order_id ?? "").includes("-sl"),
      ) ?? null;

    const activeSell =
      this.exchangeOrderRepository.findActiveSellByCycleId(cycle.id);

    return {
      cycleId: cycle.id,
      symbol: cycle.symbol,
      cycleNumber: cycle.cycle_number,
      cycleStatus: cycle.status,
      configVersion: configSnapshot?.version ?? null,
      position: {
        quantity: position.totalQuantity,
        averagePrice: position.averagePrice,
        totalCost: position.totalCost,
      },
      takeProfit: {
        enabled: Boolean(config),
        percentage: config?.takeProfit ?? null,
        calculatedPrice: takeProfitPrice,
        quantity: position.totalQuantity,
        order: tpOrder
          ? {
              id: tpOrder.id,
              exchangeOrderId: tpOrder.exchange_order_id,
              clientOrderId: tpOrder.client_order_id,
              status: tpOrder.status,
              price: Number(tpOrder.price),
              quantity: Number(tpOrder.quantity),
              orderType: tpOrder.order_type,
            }
          : null,
      },
      stopLoss: {
        enabled: Boolean(config),
        percentage: config?.stopLoss ?? null,
        calculatedPrice: stopLossPrice,
        quantity: position.totalQuantity,
        lockedToInitialPrice: true,
        order: slOrder
          ? {
              id: slOrder.id,
              exchangeOrderId: slOrder.exchange_order_id,
              clientOrderId: slOrder.client_order_id,
              status: slOrder.status,
              price: Number(slOrder.price),
              quantity: Number(slOrder.quantity),
              orderType: slOrder.order_type,
            }
          : null,
      },
      activeExit: activeSell
        ? {
            id: activeSell.id,
            reason: String(activeSell.client_order_id ?? "").includes("-sl")
              ? "STOP_LOSS"
              : "TAKE_PROFIT",
            status: activeSell.status,
            price: Number(activeSell.price),
            quantity: Number(activeSell.quantity),
          }
        : null,
    };
  }
}
