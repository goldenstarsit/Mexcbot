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
  VALUES (?, ?, 'EXIT_PENDING', ?)
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
  exchangeOrderId: `M67-SELL-${unique}`,
  clientOrderId: `m67-sell-${unique}`,
  side: "SELL",
  orderType: "LIMIT_MAKER",
  price: 101,
  quantity: 0.03,
  status: "NEW",
  placementResponse: {
    orderId: `M67-SELL-${unique}`,
  },
});

let poll = 0;
let exitBusinessCalls = 0;

const mexcClient = {
  async getOrder() {
    poll += 1;

    if (poll === 1) {
      return {
        orderId: `M67-SELL-${unique}`,
        symbol,
        status: "PARTIALLY_FILLED",
        origQty: "0.03",
        executedQty: "0.01",
        avgPrice: "101",
        fills: [{
          tradeId: `M67-SELL-TRADE-1-${unique}`,
          price: "101",
          qty: "0.01",
          commission: "0",
          commissionAsset: "USDT",
        }],
      };
    }

    return {
      orderId: `M67-SELL-${unique}`,
      symbol,
      status: "FILLED",
      origQty: "0.03",
      executedQty: "0.03",
      avgPrice: "101",
      fills: [
        {
          tradeId: `M67-SELL-TRADE-1-${unique}`,
          price: "101",
          qty: "0.01",
          commission: "0",
          commissionAsset: "USDT",
        },
        {
          tradeId: `M67-SELL-TRADE-2-${unique}`,
          price: "101",
          qty: "0.02",
          commission: "0",
          commissionAsset: "USDT",
        },
      ],
    };
  },
};

const service = new ExchangeOrderFillMonitorService({
  mexcClient,
  exchangeOrderRepository,
  fillRepository,
  tradingCycleExecutionService: {
    async processInitialFill() {
      return { ok: true };
    },
    async processDcaFill() {
      return { ok: true };
    },
  },
  cycleLifecycleService: {
    async completeExitAndStartNewCycle() {
      exitBusinessCalls += 1;
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

const fills = fillRepository.findByExchangeOrderId(exchangeOrder.id);

console.log("M67 PARTIAL-SELL FLOW:");
console.log({
  firstStatus: first.status,
  secondStatus: second.status,
  fillCount: fills.length,
  totalSoldQuantity: fills.reduce(
    (sum, fill) => sum + Number(fill.quantity),
    0,
  ),
  exitBusinessCalls,
});

assert.equal(first.status, "PARTIALLY_FILLED");
assert.equal(second.status, "FILLED");
assert.equal(fills.length, 2);
assert.equal(
  fills.reduce((sum, fill) => sum + Number(fill.quantity), 0),
  0.03,
);
assert.equal(exitBusinessCalls, 1);

console.log("M67 PARTIAL-SELL TEST: PASS");

db.prepare("DELETE FROM trading_cycles WHERE id = ?").run(cycleId);
