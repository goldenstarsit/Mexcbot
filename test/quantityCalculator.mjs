import assert from "node:assert/strict";
import MexcSymbolRules from "../src/exchange/mexcSymbolRules.js";
import QuantityCalculator from "../src/services/quantityCalculator.js";

const symbolData = {
  BTCUSDT: { price: 95000, baseAssetPrecision: 5, baseSizePrecision: "0.00001", quoteAmountPrecision: "1" },
  ETHUSDT: { price: 3000, baseAssetPrecision: 4, baseSizePrecision: "0.0001", quoteAmountPrecision: "1" },
  BNBUSDT: { price: 700, baseAssetPrecision: 3, baseSizePrecision: "0.001", quoteAmountPrecision: "1" },
  SOLUSDT: { price: 140, baseAssetPrecision: 2, baseSizePrecision: "0.01", quoteAmountPrecision: "1" },
  TRXUSDT: { price: 0.34, baseAssetPrecision: 0, baseSizePrecision: "1", quoteAmountPrecision: "1" },
};

const calculator = new QuantityCalculator(1);

for (const [symbol, data] of Object.entries(symbolData)) {
  const client = {
    async getExchangeInfo() {
      return {
        symbol,
        status: "ENABLED",
        baseAsset: symbol.replace("USDT", ""),
        quoteAsset: "USDT",
        ...data,
        quotePrecision: 2,
        orderTypes: ["LIMIT", "LIMIT_MAKER"],
        isSpotTradingAllowed: true,
        tradeSideType: "1",
        makerCommission: "0.001",
        takerCommission: "0.001",
      };
    },
  };

  const rules = await new MexcSymbolRules(client).get(symbol);
  const quantity = calculator.calculateBuyQuantity(data.price, rules);
  const notional = quantity * data.price;
  const steps = quantity / rules.stepSize;

  assert(quantity >= rules.minQty);
  assert(notional >= 1);
  assert(Math.abs(steps - Math.round(steps)) < 1e-9);
}

console.log("QUANTITY REGRESSION → ALL 5 SYMBOLS: PASS");
