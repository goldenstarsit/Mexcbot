import assert from "node:assert/strict";
import db from "../src/database/connection.js";
import "../src/database/migrations/index.js";
import ExchangeOrderRepository from "../src/database/repositories/exchangeOrderRepository.js";
import FillRepository from "../src/database/repositories/fillRepository.js";
import ExchangeOrderFillMonitorService from "../src/services/exchangeOrderFillMonitorService.js";

const unique = Date.now();
const symbol = "BTCUSDT";

const cycle = db.prepare(`
  INSERT INTO trading_cycles (
    symbol,
    cycle_number,
    status,
    config_snapshot_json
  )
  VALUES (?, ?, 'OPEN', ?)
`).run(
  symbol,
  unique,
  JSON.stringify({
    version: 1,
    config: {
      takeProfit: 1,
      stopLoss: 50,
    },
  }),
);

const cycleId = Number(cycle.lastInsertRowid);
const exchangeOrderRepository = new ExchangeOrderRepository();
const fillRepository = new FillRepository();

const exchangeOrder = exchangeOrderRepository.create({
  tradingCycleId: cycleId,
  symbol,
  exchangeOrderId: `M67-FALLBACK-${unique}`,
  clientOrderId: `m67-fallback-${unique}`,
  side: "BUY",
  orderType: "LIMIT_MAKER",
  price: 100,
  quantity: 0.03,
  status: "NEW",
  placementResponse: {
    orderId: `M67-FALLBACK-${unique}`,
  },
});

let poll = 0;

const mexcClient = {
  async getOrder() {
    poll += 1;

    if (poll === 1) {
      return {
        orderId: `M67-FALLBACK-${unique}`,
        symbol,
        status: "PARTIALLY_FILLED",
        origQty: "0.03",
        executedQty: "0.01",
        avgPrice: "100",
      };
    }

    if (poll === 2) {
      return {
        orderId: `M67-FALLBACK-${unique}`,
        symbol,
        status: "PARTIALLY_FILLED",
        origQty: "0.03",
        executedQty: "0.02",
        avgPrice: "100.5",
      };
    }

    return {
      orderId: `M67-FALLBACK-${unique}`,
      symbol,
      status: "FILLED",
      origQty: "0.03",
      executedQty: "0.03",
      avgPrice: "101",
    };
  },
};

const service = new ExchangeOrderFillMonitorService({
  mexcClient,
  exchangeOrderRepository,
  fillRepository,
  tradingCycleExecutionService: {
    async processInitialFill({ fill }) {
      assert.equal(Number(fill.quantity), 0.01);
      return { ok: true };
    },
    async processDcaFill() {
      return { ok: true };
    },
  },
  cycleLifecycleService: {
    async completeExitAndStartNewCycle() {
      return { ok: true };
    },
  },
  tradingConfigService: null,
});

const first = await service.processOrder({
  exchangeOrder,
  symbol,
});

const second = await service.processOrder({
  exchangeOrder: exchangeOrderRepository.findById(exchangeOrder.id),
  symbol,
});

const third = await service.processOrder({
  exchangeOrder: exchangeOrderRepository.findById(exchangeOrder.id),
  symbol,
});

const fills = fillRepository.findByExchangeOrderId(exchangeOrder.id);

console.log("M67 FALLBACK PARTIAL-FILL FLOW:");
console.log({
  firstStatus: first.status,
  secondStatus: second.status,
  thirdStatus: third.status,
  fillCount: fills.length,
  totalFilledQuantity: fills.reduce(
    (sum, fill) => sum + Number(fill.quantity),
    0,
  ),
  tradeIds: fills.map((fill) => fill.exchange_trade_id),
});

assert.equal(first.status, "PARTIALLY_FILLED");
assert.equal(second.status, "PARTIALLY_FILLED");
assert.equal(third.status, "FILLED");
assert.equal(fills.length, 3);
assert.equal(
  fills.reduce((sum, fill) => sum + Number(fill.quantity), 0),
  0.03,
);

console.log("M67 FALLBACK PARTIAL-FILL TEST: PASS");

db.prepare("DELETE FROM trading_cycles WHERE id = ?").run(cycleId);
