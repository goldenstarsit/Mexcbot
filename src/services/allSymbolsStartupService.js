export default class AllSymbolsStartupService {
  constructor({
    tradingConfig,
    marketPriceService,
    tradingCycleRepository,
    tradingCycleExecutionService,
  }) {
    this.tradingConfig = tradingConfig;
    this.marketPriceService = marketPriceService;
    this.tradingCycleRepository = tradingCycleRepository;
    this.tradingCycleExecutionService = tradingCycleExecutionService;
    this.startedSymbols = new Set();
  }

  async getValidMarket(symbol) {
    const market = await this.marketPriceService.getMarketPrice(symbol);

    const values = [
      market?.price,
      market?.bidPrice,
      market?.askPrice,
    ];

    if (!values.every((value) => Number.isFinite(Number(value)) && Number(value) > 0)) {
      return null;
    }

    return market;
  }

  async waitForAllSymbols() {
    const symbols = this.tradingConfig.symbols;

    const markets = await Promise.all(
      symbols.map(async (symbol) => ({
        symbol,
        market: await this.getValidMarket(symbol),
      })),
    );

    const ready = markets.every((item) => item.market !== null);

    if (!ready) {
      return {
        ready: false,
        symbols,
        markets,
        cyclesStarted: false,
      };
    }

    return {
      ready: true,
      symbols,
      markets,
      cyclesStarted: false,
    };
  }

  async startInitialCycles() {
    const readiness = await this.waitForAllSymbols();

    if (!readiness.ready) {
      return readiness;
    }

    const results = [];

    for (const symbol of readiness.symbols) {
      if (this.startedSymbols.has(symbol)) {
        results.push({
          symbol,
          status: "ALREADY_STARTED",
        });
        continue;
      }

      const existingCycle =
        await this.tradingCycleRepository.findOpenBySymbol(symbol);

      if (existingCycle) {
        this.startedSymbols.add(symbol);

        results.push({
          symbol,
          cycleId: existingCycle.id,
          status: "ALREADY_OPEN",
        });

        continue;
      }

      const cycle = await this.tradingCycleRepository.create({
        symbol,
        status: "OPEN",
      });

      const initialOrder =
        await this.tradingCycleExecutionService.triggerInitialOrder({
          cycleId: cycle.id,
          symbol,
        });

      this.startedSymbols.add(symbol);

      results.push({
        symbol,
        cycleId: cycle.id,
        status: "INITIAL_ORDER_TRIGGERED",
        initialOrder,
      });
    }

    return {
      ready: true,
      cyclesStarted: true,
      results,
    };
  }

  resetSymbol(symbol) {
    this.startedSymbols.delete(symbol);
  }

  resetAll() {
    this.startedSymbols.clear();
  }
}
