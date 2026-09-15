import assert from "node:assert/strict";

import db from "../src/database/connection.js";
import "../src/database/migrations/index.js";
import ExchangeOrderFillMonitorService from "../src/services/exchangeOrderFillMonitorService.js";
import ExchangeOrderRepository from "../src/database/repositories/exchangeOrderRepository.js";
import FillRepository from "../src/database/repositories/fillRepository.js";
import PositionCalculator from "../src/services/positionCalculator.js";

const unique = Date.now();
const symbol = `M68TEST${unique}`;

const cycle = db.prepare(`
  INSERT INTO trading_cycles (symbol, cycle_number, status, created_at)
  VALUES (?, 1, 'OPEN', CURRENT_TIMESTAMP)
`).run(symbol);

const cycleId = Number(cycle.lastInsertRowid);
const exchangeOrderRepository = new ExchangeOrderRepository();
const fillRepository = new FillRepository();
const positionCalculator = new PositionCalculator();

const buyOrder = exchangeOrderRepository.create({
  tradingCycleId: cycleId,
  symbol,
  exchangeOrderId: `M68-BUY-${unique}`,
  clientOrderId: `m68-buy-${unique}`,
  side: "BUY",
  orderType: "LIMIT_MAKER",
  price: 100,
  quantity: 0.03,
  status: "NEW",
  placementResponse: { orderId: `M68-BUY-${unique}` },
});

let businessCalls = 0;
let initialFillCalls = 0;
let dcaFillCalls = 0;

const service = new ExchangeOrderFillMonitorService({
  mexcClient: {
    async getOrder() {
      return {
        orderId: `M68-BUY-${unique}`,
        symbol,
        status: "FILLED",
        origQty: "0.03",
        executedQty: "0.03",
        fills: [
          { tradeId: `M68-T1-${unique}`, price: "100", qty: "0.01" },
          { tradeId: `M68-T2-${unique}`, price: "101", qty: "0.01" },
          { tradeId: `M68-T3-${unique}`, price: "103", qty: "0.01" },
        ],
      };
    },
  },
  exchangeOrderRepository,
  fillRepository,
  tradingCycleExecutionService: {
    async processInitialFill({ fill }) {
      businessCalls++;
      initialFillCalls++;
      assert.equal(Number(fill.quantity), 0.01);
      assert.equal(Number(fill.price), 100);
      return { ok: true };
    },
    async processDcaFill({ fills }) {
      businessCalls++;
      dcaFillCalls++;
      assert.equal(fills.length, 3);
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
const position = positionCalculator.calculate(fills);

console.log("M68 MULTIPLE-FILL FLOW:");
console.log({
  status: result.status,
  fillCount: fills.length,
  totalQuantity: position.totalQuantity,
  totalCost: position.totalCost,
  averagePrice: position.averagePrice,
  businessCalls,
  initialFillCalls,
  dcaFillCalls,
});

assert.equal(result.status, "FILLED");
assert.equal(fills.length, 3);
assert.equal(position.totalQuantity, 0.03);
assert.equal(position.totalCost, 3.04);
assert.equal(
  Number(position.averagePrice.toFixed(10)),
  Number((3.04 / 0.03).toFixed(10)),
);
assert.equal(businessCalls, 3);
assert.equal(initialFillCalls, 1);
assert.equal(dcaFillCalls, 2);

console.log("M68 MULTIPLE-FILL HANDLING: PASS");
console.log("M68 MULTIPLE-FILLS TEST: PASS");

db.prepare("DELETE FROM trading_cycles WHERE id = ?").run(cycleId);
