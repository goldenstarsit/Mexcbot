export default class MexcHealthService {
  constructor({
    mexcClient,
    tradingConfigService,
  }) {
    if (!mexcClient) {
      throw new Error("MEXC client is required");
    }

    if (!tradingConfigService) {
      throw new Error("Trading config service is required");
    }

    this.mexcClient = mexcClient;
    this.tradingConfigService = tradingConfigService;
  }

  async check() {
    const runtimeConfig =
      this.tradingConfigService.getCurrent();

    const symbol =
      runtimeConfig.config.symbols?.[0];

    if (!symbol) {
      return {
        status: "ERROR",
        connected: false,
        error: "No trading symbol is configured",
      };
    }

    const startedAt = Date.now();

    try {
      const response =
        await this.mexcClient.getPrice(symbol);

      return {
        status: "OK",
        connected: true,
        symbol,
        price: response.price ?? null,
        latencyMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: "ERROR",
        connected: false,
        symbol,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error
          ? error.message
          : String(error),
        checkedAt: new Date().toISOString(),
      };
    }
  }
}
