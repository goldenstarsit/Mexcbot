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

    const baseAssetPrecision = Number(info.baseAssetPrecision);
    const baseSizePrecision = Number(info.baseSizePrecision);
    const quoteAmountPrecision = Number(info.quoteAmountPrecision);

    const rules = {
      symbol: info.symbol,
      status: info.status,
      baseAsset: info.baseAsset,
      quoteAsset: info.quoteAsset,

      // MEXC:
      // baseSizePrecision = minimum base-asset quantity
      // baseAssetPrecision = number of decimal places allowed
      // Therefore stepSize = 10 ^ -baseAssetPrecision
      baseAssetPrecision,
      baseSizePrecision,
      stepSize: 10 ** -baseAssetPrecision,

      quoteAmountPrecision,
      quotePrecision: Number(info.quotePrecision),
      baseAssetPrecisionValue: baseAssetPrecision,

      orderTypes: info.orderTypes ?? [],
      isSpotTradingAllowed: info.isSpotTradingAllowed === true,
      tradeSideType: String(info.tradeSideType ?? ""),
      makerCommission: Number(info.makerCommission),
      takerCommission: Number(info.takerCommission),

      // MEXC exchangeInfo:
      // quoteAmountPrecision = minimum order amount
      // baseSizePrecision = minimum order quantity
      minNotional: quoteAmountPrecision,
      minQty: baseSizePrecision,
    };

    if (!Number.isInteger(baseAssetPrecision) || baseAssetPrecision < 0) {
      throw new Error(`Invalid baseAssetPrecision for ${symbol}`);
    }

    if (!Number.isFinite(rules.stepSize) || rules.stepSize <= 0) {
      throw new Error(`Invalid stepSize for ${symbol}`);
    }

    if (!Number.isFinite(rules.minQty) || rules.minQty <= 0) {
      throw new Error(`Invalid minQty for ${symbol}`);
    }

    if (!Number.isFinite(rules.minNotional) || rules.minNotional <= 0) {
      throw new Error(`Invalid minNotional for ${symbol}`);
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
