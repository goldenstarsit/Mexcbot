import assert from "node:assert/strict";

import db from "../src/database/connection.js";
import "../src/database/migrations/index.js";
import ExchangeOrderFillMonitorService from "../src/services/exchangeOrderFillMonitorService.js";
import ExchangeOrderRepository from "../src/database/repositories/exchangeOrderRepository.js";
import FillRepository from "../src/database/repositories/fillRepository.js";

const unique = Date.now();
const symbol = `M67TEST${unique}`;

const cycle = db.prepare(`
  INSERT INTO trading_cycles (symbol, cycle_number, status, created_at)
  VALUES (?, 1, 'OPEN', CURRENT_TIMESTAMP)
`).run(symbol);

const cycleId = Number(cycle.lastInsertRowid);
const exchangeOrderRepository = new ExchangeOrderRepository();
const fillRepository = new FillRepository();

const exchangeOrder = exchangeOrderRepository.create({
  tradingCycleId: cycleId,
  symbol,
  exchangeOrderId: `M67-ORDER-${unique}`,
  clientOrderId: `m67-${unique}`,
  side: "BUY",
  orderType: "LIMIT_MAKER",
  price: 100,
  quantity: 0.03,
  status: "NEW",
  placementResponse: { orderId: `M67-ORDER-${unique}` },
});

let poll = 0;
let businessCalls = 0;
let initialFillCalls = 0;
let dcaFillCalls = 0;

const mexcClient = {
  async getOrder() {
    poll += 1;

    if (poll === 1) {
      return {
        orderId: `M67-ORDER-${unique}`,
        symbol,
        status: "PARTIALLY_FILLED",
        origQty: "0.03",
        executedQty: "0.01",
        avgPrice: "100",
        fills: [{
          tradeId: `M67-TRADE-1-${unique}`,
          price: "100",
          qty: "0.01",
          commission: "0",
          commissionAsset: "USDT",
        }],
      };
    }

    if (poll === 2) {
      return {
        orderId: `M67-ORDER-${unique}`,
        symbol,
        status: "PARTIALLY_FILLED",
        origQty: "0.03",
        executedQty: "0.02",
        avgPrice: "100.5",
        fills: [
          {
            tradeId: `M67-TRADE-1-${unique}`,
            price: "100",
            qty: "0.01",
            commission: "0",
            commissionAsset: "USDT",
          },
          {
            tradeId: `M67-TRADE-2-${unique}`,
            price: "101",
            qty: "0.01",
            commission: "0",
            commissionAsset: "USDT",
          },
        ],
      };
    }

    return {
      orderId: `M67-ORDER-${unique}`,
      symbol,
      status: "FILLED",
      origQty: "0.03",
      executedQty: "0.03",
      avgPrice: "101",
      fills: [
        {
          tradeId: `M67-TRADE-1-${unique}`,
          price: "100",
          qty: "0.01",
          commission: "0",
          commissionAsset: "USDT",
        },
        {
          tradeId: `M67-TRADE-2-${unique}`,
          price: "101",
          qty: "0.01",
          commission: "0",
          commissionAsset: "USDT",
        },
        {
          tradeId: `M67-TRADE-3-${unique}`,
          price: "102",
          qty: "0.01",
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
    async processInitialFill({ fill }) {
      businessCalls += 1;
      initialFillCalls += 1;
      assert.equal(Number(fill.quantity), 0.01);
      return { ok: true };
    },
    async processDcaFill() {
      businessCalls += 1;
      dcaFillCalls += 1;
      return { ok: true };
    },
  },
  cycleLifecycleService: {
    async completeExitAndStartNewCycle() {
      businessCalls += 1;
      return { ok: true };
    },
  },
  tradingConfigService: null,
});

const first = await service.processOrder({ exchangeOrder, symbol });
const second = await service.processOrder({
  exchangeOrder: exchangeOrderRepository.findById(exchangeOrder.id),
  symbol,
});
const third = await service.processOrder({
  exchangeOrder: exchangeOrderRepository.findById(exchangeOrder.id),
  symbol,
});

const fills = fillRepository.findByExchangeOrderId(exchangeOrder.id);
const finalOrder = exchangeOrderRepository.findById(exchangeOrder.id);

console.log("M67 PARTIAL-FILL FLOW:");
console.log({
  firstStatus: first.status,
  secondStatus: second.status,
  thirdStatus: third.status,
  fillCount: fills.length,
  totalFilledQuantity: fills.reduce(
    (sum, fill) => sum + Number(fill.quantity),
    0,
  ),
  uniqueTradeIds: new Set(
    fills.map((fill) => fill.exchange_trade_id),
  ).size,
  businessCalls,
  initialFillCalls,
  dcaFillCalls,
  finalOrderStatus: finalOrder.status,
});

assert.equal(first.status, "PARTIALLY_FILLED");
assert.equal(second.status, "PARTIALLY_FILLED");
assert.equal(third.status, "FILLED");
assert.equal(fills.length, 3);
assert.equal(
  fills.reduce((sum, fill) => sum + Number(fill.quantity), 0),
  0.03,
);
assert.equal(new Set(fills.map((fill) => fill.exchange_trade_id)).size, 3);
assert.equal(businessCalls, 3);
assert.equal(initialFillCalls, 1);
assert.equal(dcaFillCalls, 2);
assert.equal(finalOrder.status, "FILLED");

console.log("M67 PARTIAL-FILL HANDLING: PASS");

console.log("M67 PARTIAL-FILL TEST: PASS");

db.prepare("DELETE FROM trading_cycles WHERE id = ?").run(cycleId);
