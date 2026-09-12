export default class CycleLifecycleService {
  constructor({
    tradingCycleRepository,
    exchangeOrderRepository,
    fillRepository,
    positionCalculator,
    marketPriceService,
    makerOrderEngine,
    triggerInitialOrder,
  }) {
    this.tradingCycleRepository = tradingCycleRepository;
    this.exchangeOrderRepository = exchangeOrderRepository;
    this.fillRepository = fillRepository;
    this.positionCalculator = positionCalculator;
    this.marketPriceService = marketPriceService;
    this.makerOrderEngine = makerOrderEngine;
    this.triggerInitialOrder = triggerInitialOrder;
  }

  async triggerExit({
    cycleId,
    symbol,
    reason,
    fills,
  }) {
    if (!Number.isInteger(cycleId) || cycleId <= 0) {
      throw new Error("Valid cycleId is required");
    }

    if (!symbol) {
      throw new Error("Symbol is required");
    }

    if (!["TAKE_PROFIT", "STOP_LOSS"].includes(reason)) {
      throw new Error("Exit reason must be TAKE_PROFIT or STOP_LOSS");
    }

    const position = this.positionCalculator.calculate(fills);

    if (position.totalQuantity <= 0) {
      throw new Error("No position available to sell");
    }

    const market = await this.marketPriceService.get(symbol);

    const sellPrice =
      reason === "TAKE_PROFIT"
        ? market.askPrice
        : market.bidPrice;

    const bestBid = market.bidPrice;

    const order = await this.makerOrderEngine.placeSell({
      symbol,
      quantity: position.totalQuantity,
      price: sellPrice,
      bestBid,
    });

    const exchangeOrder = await this.exchangeOrderRepository.create({
      tradingCycleId: cycleId,
      symbol,
      exchangeOrderId: String(
        order.orderId ?? order.order_id ?? order.id ?? "",
      ),
      side: "SELL",
      orderType: "LIMIT_MAKER",
      price: sellPrice,
      quantity: position.totalQuantity,
      status: "NEW",
    });

    await this.tradingCycleRepository.updateStatus(
      cycleId,
      "EXIT_PENDING",
    );

    return {
      cycleId,
      symbol,
      reason,
      quantity: position.totalQuantity,
      price: sellPrice,
      exchangeOrder,
      newCycleStarted: false,
    };
  }

  async processExitFill({
    cycleId,
    symbol,
    fill,
  }) {
    if (!fill) {
      throw new Error("Exit fill is required");
    }

    const quantity = Number(fill.quantity);
    const price = Number(fill.price);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("Exit fill quantity must be greater than 0");
    }

    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("Exit fill price must be greater than 0");
    }

    await this.fillRepository.create({
      symbol,
      side: "SELL",
      quantity,
      price,
    });

    await this.tradingCycleRepository.updateStatus(
      cycleId,
      "CLOSED",
    );

    return {
      cycleId,
      symbol,
      status: "CLOSED",
      sellFilled: true,
      newCycleReady: true,
    };
  }

  async startNewCycle({
    previousCycleId,
    symbol,
  }) {
    if (!Number.isInteger(previousCycleId) || previousCycleId <= 0) {
      throw new Error("Valid previousCycleId is required");
    }

    if (!symbol) {
      throw new Error("Symbol is required");
    }

    if (typeof this.triggerInitialOrder !== "function") {
      throw new Error("Initial order trigger is not configured");
    }

    const openCycle =
      await this.tradingCycleRepository.findOpenBySymbol(symbol);

    if (openCycle) {
      throw new Error(
        `Cannot start new cycle for ${symbol}: previous cycle is still open`,
      );
    }

    const cycle =
      await this.tradingCycleRepository.create({
        symbol,
        status: "OPEN",
      });

    return {
      previousCycleId,
      cycleId: cycle.id,
      cycleNumber: cycle.cycle_number,
      symbol,
      status: "OPEN",
      initialOrderReady: true,
    };
  }

  async completeExitAndStartNewCycle({
    cycleId,
    symbol,
    fill,
  }) {
    const exit = await this.processExitFill({
      cycleId,
      symbol,
      fill,
    });

    const cycle = await this.startNewCycle({
      previousCycleId: cycleId,
      symbol,
    });

    const initialOrder = await this.triggerInitialOrder({
      cycleId: cycle.cycleId,
      symbol,
    });

    return {
      exit,
      cycle,
      initialOrder,
      newCycleStarted: true,
    };
  }
}
