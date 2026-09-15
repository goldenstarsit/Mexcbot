import assert from "node:assert/strict";
import MakerOrderEngine from "../src/services/makerOrderEngine.js";
import tradingConfig from "../src/config/trading.config.js";
import { validateTradingConfig } from "../src/config/validateTradingConfig.js";

const calls = [];

const mexcClient = {
  async createOrder(payload) {
    calls.push(payload);
    return {
      orderId: `M100-${calls.length}`,
      status: "NEW",
      ...payload,
    };
  },
};

function expectThrow(fn, message) {
  assert.throws(fn, new RegExp(message));
}

validateTradingConfig(tradingConfig);

const engine = new MakerOrderEngine(mexcClient, tradingConfig);

// BUY: valid maker price must remain below best ask.
const buy = await engine.placeBuy({
  symbol: "BTCUSDT",
  quantity: 0.00001,
  price: 99,
  bestAsk: 100,
  clientOrderId: "M100-BUY-001",
});

assert.equal(buy.type, "LIMIT_MAKER");
assert.equal(buy.side, "BUY");
assert.equal(calls[0].type, "LIMIT_MAKER");
assert.equal(calls[0].side, "BUY");

// BUY at or above best ask would take liquidity.
expectThrow(
  () =>
    engine.validateBuyPrice(100, 100),
  "BUY maker order would take liquidity",
);

expectThrow(
  () =>
    engine.validateBuyPrice(101, 100),
  "BUY maker order would take liquidity",
);

// SELL: valid maker price must remain above best bid.
const sell = await engine.placeSell({
  symbol: "BTCUSDT",
  quantity: 0.00001,
  price: 101,
  bestBid: 100,
  clientOrderId: "M100-SELL-001",
});

assert.equal(sell.type, "LIMIT_MAKER");
assert.equal(sell.side, "SELL");
assert.equal(calls[1].type, "LIMIT_MAKER");
assert.equal(calls[1].side, "SELL");

// SELL at or below best bid would take liquidity.
expectThrow(
  () =>
    engine.validateSellPrice(100, 100),
  "SELL maker order would take liquidity",
);

expectThrow(
  () =>
    engine.validateSellPrice(99, 100),
  "SELL maker order would take liquidity",
);

// Invalid market references must be rejected.
expectThrow(
  () =>
    engine.validateBuyPrice(99, 0),
  "Best ask must be greater than 0",
);

expectThrow(
  () =>
    engine.validateSellPrice(101, 0),
  "Best bid must be greater than 0",
);

// Constructor-level maker-only protection.
expectThrow(
  () =>
    new MakerOrderEngine(mexcClient, {
      ...tradingConfig,
      order: { ...tradingConfig.order, type: "LIMIT" },
    }),
  "requires LIMIT_MAKER",
);

expectThrow(
  () =>
    new MakerOrderEngine(mexcClient, {
      ...tradingConfig,
      order: { ...tradingConfig.order, makerOnly: false },
    }),
  "Maker-only trading must be enabled",
);

assert.equal(calls.length, 2);
assert.ok(calls.every((order) => order.type === "LIMIT_MAKER"));
assert.ok(calls.every((order) => order.side === "BUY" || order.side === "SELL"));

console.log("M100 MAKER-ONLY FINAL AUDIT: PASS");
console.log({
  configValidated: true,
  buyLimitMaker: buy.type === "LIMIT_MAKER",
  sellLimitMaker: sell.type === "LIMIT_MAKER",
  buyMakerPriceProtected: true,
  sellMakerPriceProtected: true,
  buyLiquidityTakingRejected: true,
  sellLiquidityTakingRejected: true,
  invalidMarketReferencesRejected: true,
  invalidOrderTypeRejected: true,
  makerOnlyDisabledRejected: true,
  allExchangeCallsMakerOnly: calls.every(
    (order) => order.type === "LIMIT_MAKER",
  ),
});
