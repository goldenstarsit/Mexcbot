import assert from "node:assert/strict";
import MexcSymbolRules from "../src/exchange/mexcSymbolRules.js";

const validInfo = (overrides = {}) => ({
  symbol: "BTCUSDT",
  status: "TRADING",
  baseAsset: "BTC",
  quoteAsset: "USDT",
  baseAssetPrecision: 5,
  baseSizePrecision: 0.00001,
  quoteAmountPrecision: 1,
  quotePrecision: 2,
  orderTypes: ["LIMIT", "LIMIT_MAKER", "MARKET"],
  isSpotTradingAllowed: true,
  tradeSideType: "1",
  makerCommission: 0,
  takerCommission: 0,
  ...overrides,
});

const createService = (info) =>
  new MexcSymbolRules({
    async getExchangeInfo() {
      return { symbols: [info] };
    },
  });

const valid = await createService(validInfo()).get("BTCUSDT");

assert.equal(valid.symbol, "BTCUSDT");
assert.equal(valid.stepSize, 0.00001);
assert.equal(valid.minQty, 0.00001);
assert.equal(valid.minNotional, 1);
assert.equal(valid.quotePrecision, 2);
assert.equal(valid.orderTypes.includes("LIMIT_MAKER"), true);
assert.equal(valid.isSpotTradingAllowed, true);

await assert.rejects(
  () => createService(validInfo({ baseAssetPrecision: Number.NaN })).get("BTCUSDT"),
  /Invalid baseAssetPrecision/,
);

await assert.rejects(
  () => createService(validInfo({ baseSizePrecision: 0 })).get("BTCUSDT"),
  /Invalid minQty/,
);

await assert.rejects(
  () => createService(validInfo({ quoteAmountPrecision: 0 })).get("BTCUSDT"),
  /Invalid quoteAmountPrecision/,
);

await assert.rejects(
  () => createService(validInfo({ quotePrecision: Number.NaN })).get("BTCUSDT"),
  /Invalid quotePrecision/,
);

await assert.rejects(
  () => createService(validInfo({ orderTypes: ["LIMIT", "MARKET"] })).get("BTCUSDT"),
  /LIMIT_MAKER is not supported/,
);

await assert.rejects(
  () => createService(validInfo({ isSpotTradingAllowed: false })).get("BTCUSDT"),
  /Spot trading is not allowed/,
);

await assert.rejects(
  () =>
    createService(
      validInfo({
        baseAssetPrecision: 3,
        baseSizePrecision: 0.0005,
      }),
    ).get("BTCUSDT"),
  /minQty must be aligned with stepSize/,
);

console.log("M99 SYMBOL RULE VALIDATION: PASS");
console.log({
  validRulesAccepted: true,
  invalidBasePrecisionRejected: true,
  invalidMinimumQuantityRejected: true,
  invalidMinimumNotionalRejected: true,
  invalidQuotePrecisionRejected: true,
  makerOnlyUnsupportedRejected: true,
  spotTradingDisabledRejected: true,
  misalignedQuantityRulesRejected: true,
});
