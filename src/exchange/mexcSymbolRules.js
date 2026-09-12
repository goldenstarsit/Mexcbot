export default class MexcSymbolRules {
  constructor(mexcClient) {
    this.mexcClient = mexcClient;
    this.cache = new Map();
  }

  async get(symbol) {
    if (this.cache.has(symbol)) {
      return this.cache.get(symbol);
    }

    const response = await this.mexcClient.getExchangeInfo(symbol);
    const info = Array.isArray(response.symbols)
      ? response.symbols.find((item) => item.symbol === symbol)
      : response.symbol;

    if (!info) {
      throw new Error(`MEXC symbol rules not found: ${symbol}`);
    }

    const rules = {
      symbol: info.symbol,
      status: info.status,
      baseAsset: info.baseAsset,
      quoteAsset: info.quoteAsset,
      baseSizePrecision: Number(info.baseSizePrecision),
      quoteAmountPrecision: Number(info.quoteAmountPrecision),
      quotePrecision: Number(info.quotePrecision),
      baseAssetPrecision: Number(info.baseAssetPrecision),
      orderTypes: info.orderTypes ?? [],
      isSpotTradingAllowed: info.isSpotTradingAllowed === true,
      tradeSideType: String(info.tradeSideType ?? ""),
      makerCommission: Number(info.makerCommission),
      takerCommission: Number(info.takerCommission),
      minNotional: Number(info.quoteAmountPrecision),
      minQty: Number(info.baseSizePrecision),
    };

    if (!Number.isFinite(rules.baseSizePrecision) || rules.baseSizePrecision <= 0) {
      throw new Error(`Invalid baseSizePrecision for ${symbol}`);
    }

    if (!Number.isFinite(rules.quoteAmountPrecision) || rules.quoteAmountPrecision <= 0) {
      throw new Error(`Invalid quoteAmountPrecision for ${symbol}`);
    }

    if (!rules.orderTypes.includes("LIMIT_MAKER")) {
      throw new Error(`LIMIT_MAKER is not supported for ${symbol}`);
    }

    if (!rules.isSpotTradingAllowed) {
      throw new Error(`Spot trading is not allowed for ${symbol}`);
    }

    this.cache.set(symbol, rules);
    return rules;
  }

  clear(symbol) {
    if (symbol) {
      this.cache.delete(symbol);
      return;
    }

    this.cache.clear();
  }
}
