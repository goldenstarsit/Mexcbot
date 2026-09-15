import assert from "node:assert/strict";

import db from "../src/database/connection.js";
import "../src/database/migrations/index.js";
import ExchangeOrderFillMonitorService from "../src/services/exchangeOrderFillMonitorService.js";
import ExchangeOrderRepository from "../src/database/repositories/exchangeOrderRepository.js";
import FillRepository from "../src/database/repositories/fillRepository.js";

const unique = Date.now();
const symbol = `M71TEST${unique}`;

const cycle = db.prepare(`
  INSERT INTO trading_cycles (
    symbol,
    cycle_number,
    status,
    created_at,
    config_snapshot_json
  )
  VALUES (?, 1, 'OPEN', CURRENT_TIMESTAMP, ?)
`).run(
  symbol,
  JSON.stringify({
    version: 1,
    config: {
      symbols: [symbol],
      takeProfit: 1,
      stopLoss: 50,
      initialOrder: { enabled: true },
      dca: {
        enabled: true,
        formula: "triangular",
        levels: 1,
      },
      order: {
        type: "LIMIT_MAKER",
        makerOnly: true,
      },
    },
  }),
);

const cycleId = Number(cycle.lastInsertRowid);

const exchangeOrderRepository = new ExchangeOrderRepository();
const fillRepository = new FillRepository();

const buyOrder = exchangeOrderRepository.create({
  tradingCycleId: cycleId,
  symbol,
  exchangeOrderId: `M71-BUY-${unique}`,
  clientOrderId: `m71-buy-${unique}`,
  side: "BUY",
  orderType: "LIMIT_MAKER",
  price: 100,
  quantity: 0.03,
  status: "NEW",
  placementResponse: {
    orderId: `M71-BUY-${unique}`,
  },
});

let receivedInitialFills = null;
let initialCalls = 0;

const service = new ExchangeOrderFillMonitorService({
  mexcClient: {
    async getOrder() {
      return {
        orderId: `M71-BUY-${unique}`,
        symbol,
        status: "FILLED",
        origQty: "0.03",
        executedQty: "0.03",
        fills: [
          {
            tradeId: `M71-T1-${unique}`,
            price: "100",
            qty: "0.01",
          },
          {
            tradeId: `M71-T2-${unique}`,
            price: "101",
            qty: "0.01",
          },
          {
            tradeId: `M71-T3-${unique}`,
            price: "103",
            qty: "0.01",
          },
        ],
      };
    },
  },
  exchangeOrderRepository,
  fillRepository,
  tradingCycleExecutionService: {
    async processInitialFill({ fill, initialFills }) {
      initialCalls++;
      receivedInitialFills = initialFills;

      assert.equal(Number(fill.price), 100);
      assert.equal(Number(fill.quantity), 0.01);
      assert.equal(initialFills.length, 3);

      const quantity = initialFills.reduce(
        (sum, item) => sum + Number(item.quantity),
        0,
      );

      const cost = initialFills.reduce(
        (sum, item) =>
          sum + Number(item.quantity) * Number(item.price),
        0,
      );

      return {
        position: {
          totalQuantity: quantity,
          totalCost: cost,
          averagePrice: cost / quantity,
        },
      };
    },
    async processDcaFill() {
      return { ok: true };
    },
  },
  cycleLifecycleService: {
    async completeExitAndStartNewCycle() {
      throw new Error("Unexpected SELL processing");
    },
  },
  tradingConfigService: null,
});

const result = await service.processOrder({
  exchangeOrder: buyOrder,
  symbol,
});

const fills = fillRepository.findByExchangeOrderId(buyOrder.id);

const totalQuantity = fills.reduce(
  (sum, item) => sum + Number(item.quantity),
  0,
);

const totalCost = fills.reduce(
  (sum, item) =>
    sum + Number(item.quantity) * Number(item.price),
  0,
);

const averagePrice = totalCost / totalQuantity;

console.log("M71 INITIAL FILL → POSITION INTEGRITY:");
console.log({
  status: result.status,
  persistedFills: fills.length,
  receivedInitialFills: receivedInitialFills?.length ?? 0,
  totalQuantity,
  totalCost,
  averagePrice,
  initialCalls,
});

assert.equal(result.status, "FILLED");
assert.equal(fills.length, 3);
assert.equal(receivedInitialFills.length, 3);
assert.equal(initialCalls, 1);
assert.equal(totalQuantity, 0.03);
assert.equal(totalCost, 3.04);
assert.equal(
  Number(averagePrice.toFixed(10)),
  Number((3.04 / 0.03).toFixed(10)),
);

console.log("M71 INITIAL FILL → POSITION INTEGRITY: PASS");
console.log("M71 TEST: PASS");

db.prepare("DELETE FROM trading_cycles WHERE id = ?").run(cycleId);
