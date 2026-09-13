export default class CycleLifecycleService {
  constructor({
    tradingCycleRepository,
    exchangeOrderRepository,
    fillRepository,
    positionCalculator,
    marketPriceService,
    makerOrderEngine,
    quantityCalculator,
    symbolRulesService,
    duplicateProtectionService,
    triggerInitialOrder,
  }) {
    this.tradingCycleRepository = tradingCycleRepository;
    this.exchangeOrderRepository = exchangeOrderRepository;
    this.fillRepository = fillRepository;
    this.positionCalculator = positionCalculator;
    this.marketPriceService = marketPriceService;
    this.makerOrderEngine = makerOrderEngine;
    this.quantityCalculator = quantityCalculator;
    this.symbolRulesService = symbolRulesService;
    this.duplicateProtectionService = duplicateProtectionService;
    this.triggerInitialOrder = triggerInitialOrder;
  }

  async triggerExit({
    cycleId,
    symbol,
    reason,
    fills,
    clientOrderId = null,
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

    const existingExit =
      this.exchangeOrderRepository.findActiveSellByCycleId(cycleId);

    if (existingExit) {
      return {
        cycleId,
        symbol,
        reason,
        quantity: Number(existingExit.quantity),
        price: Number(existingExit.price),
        exchangeOrder: existingExit,
        newCycleStarted: false,
        reused: true,
      };
    }

    const reservation =
      this.tradingCycleRepository.reserveExit(cycleId);

    if (!reservation.reserved) {
      const cycle = reservation.cycle;

      if (cycle?.status === "EXIT_PENDING") {
        const pendingExit =
          this.exchangeOrderRepository.findActiveSellByCycleId(cycleId);

        if (pendingExit) {
          return {
            cycleId,
            symbol,
            reason,
            quantity: Number(pendingExit.quantity),
            price: Number(pendingExit.price),
            exchangeOrder: pendingExit,
            newCycleStarted: false,
            reused: true,
          };
        }

        throw new Error(
          `Exit already pending for cycle ${cycleId}`,
        );
      }

      throw new Error(
        `Cannot trigger exit for cycle ${cycleId}: status is ${cycle?.status ?? "UNKNOWN"}`,
      );
    }

    try {
      const position = this.positionCalculator.calculate(fills);

      if (position.totalQuantity <= 0) {
        throw new Error("No position available to sell");
      }

      const market = await this.marketPriceService.get(symbol);
    const rules = await this.symbolRulesService.get(symbol);

    const sellQuantity =
      this.quantityCalculator.calculateSellQuantity(
        position.totalQuantity,
        rules,
      );

    const sellPrice =
      reason === "TAKE_PROFIT"
        ? market.askPrice
        : market.bidPrice;

    const bestBid = market.bidPrice;

    const resolvedClientOrderId =
      clientOrderId ??
      this.duplicateProtectionService.createClientOrderId({
        cycleId,
        kind: reason === "TAKE_PROFIT" ? "tp" : "sl",
      });

    const placement =
      await this.duplicateProtectionService.placeSell({
        tradingCycleId: cycleId,
        symbol,
        quantity: sellQuantity,
        price: sellPrice,
        bestBid,
        clientOrderId: resolvedClientOrderId,
        reason,
      });

    const exchangeOrder = placement.exchangeOrder;

      return {
        cycleId,
        symbol,
        reason,
        quantity: sellQuantity,
        price: sellPrice,
        exchangeOrder,
        newCycleStarted: false,
        reused: placement.reused,
      };
    } catch (error) {
      await this.tradingCycleRepository.updateStatus(
        cycleId,
        "OPEN",
      );

      throw error;
    }
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
