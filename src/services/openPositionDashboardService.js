export default class OpenPositionDashboardService {
  constructor({
    tradingCycleRepository,
    fillRepository,
    positionCalculator,
    positionProtectionService,
  }) {
    this.tradingCycleRepository = tradingCycleRepository;
    this.fillRepository = fillRepository;
    this.positionCalculator = positionCalculator;
    this.positionProtectionService = positionProtectionService;
  }

  getOpenPositions({ symbol = null } = {}) {
    const cycles = symbol
      ? [this.tradingCycleRepository.findOpenBySymbol(symbol)].filter(Boolean)
      : this.tradingCycleRepository.findByStatus("OPEN");

    return cycles.map((cycle) => this.buildPosition(cycle));
  }

  buildPosition(cycle) {
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

    let takeProfit = null;
    let stopLoss = null;

    if (position.totalQuantity > 0 && config) {
      takeProfit = this.positionProtectionService.calculateTakeProfit(
        position.averagePrice,
        config,
      );

      const initialBuy = buyFills[0];

      if (initialBuy) {
        stopLoss = this.positionProtectionService.calculateStopLoss(
          Number(initialBuy.price),
          config,
        );
      }
    }

    const initialPrice =
      buyFills.length > 0 ? Number(buyFills[0].price) : null;

    const dcaFills = Math.max(buyFills.length - 1, 0);

    return {
      cycleId: cycle.id,
      symbol: cycle.symbol,
      cycleNumber: cycle.cycle_number,
      status: cycle.status,
      createdAt: cycle.created_at,
      initialPrice,
      position: {
        totalQuantity: position.totalQuantity,
        totalCost: position.totalCost,
        averagePrice: position.averagePrice,
      },
      takeProfit: {
        price: takeProfit,
        percentage: config?.takeProfit ?? null,
        quantity: position.totalQuantity,
      },
      stopLoss: {
        price: stopLoss,
        percentage: config?.stopLoss ?? null,
        quantity: position.totalQuantity,
        lockedToInitialPrice: true,
      },
      progress: {
        buyFillCount: buyFills.length,
        dcaFillCount: dcaFills,
        maxBuyOrders: 10,
      },
      configVersion: configSnapshot?.version ?? null,
    };
  }
}
