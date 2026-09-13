import assert from "node:assert/strict";
import ExchangeReconciliationService from "../src/services/exchangeReconciliationService.js";

const orders = [
  {
    id: 3801,
    trading_cycle_id: 81,
    dca_order_id: 91,
    symbol: "BTCUSDT",
    exchange_order_id: "M38-ORDER-1",
    status: "ORDER_PLACED",
  },
  {
    id: 3802,
    trading_cycle_id: 82,
    dca_order_id: null,
    symbol: "ETHUSDT",
    exchange_order_id: "M38-ORDER-2",
    status: "FILLED",
  },
  {
    id: 3803,
    trading_cycle_id: 83,
    dca_order_id: 93,
    symbol: "BNBUSDT",
    exchange_order_id: "M38-ORDER-3",
    status: "ORDER_PLACED",
  },
];

const cycles = new Map([
  [81, { id: 81, symbol: "BTCUSDT" }],
  [82, { id: 82, symbol: "ETHUSDT" }],
  [83, { id: 83, symbol: "SOLUSDT" }],
]);

const dcaOrders = new Map([
  [
    91,
    {
      id: 91,
      trading_cycle_id: 81,
      symbol: "BTCUSDT",
    },
  ],
  [
    93,
    {
      id: 93,
      trading_cycle_id: 83,
      symbol: "BNBUSDT",
    },
  ],
]);

const fills = new Map([
  [3802, [{ id: 1, exchange_order_id: 3802 }]],
]);

const mexcClient = {
  async getOrder({ orderId }) {
    return {
      orderId,
      status: "NEW",
    };
  },
};

const exchangeOrderRepository = {
  findActive() {
    return orders;
  },

  updateFinalResponse() {},

  findById(id) {
    return orders.find((order) => order.id === id);
  },
};

const service = new ExchangeReconciliationService({
  mexcClient,
  exchangeOrderRepository,
  exchangeOrderFillMonitorService: null,
  tradingCycleRepository: {
    findById(id) {
      return cycles.get(id) ?? null;
    },
  },
  dcaOrderRepository: {
    findById(id) {
      return dcaOrders.get(id) ?? null;
    },
  },
  fillRepository: {
    findByExchangeOrderId(id) {
      return fills.get(id) ?? [];
    },
  },
});

const result = await service.reconcile();

assert.equal(result.checked, 3);
assert.equal(result.dbInconsistencies, 1);
assert.equal(result.discrepancies, 2);

const consistent = result.results.find(
  (item) => item.exchangeOrderId === "M38-ORDER-1",
);

assert.equal(consistent.status, "CONSISTENT");
assert.equal(consistent.dbConsistent, true);
assert.deepEqual(consistent.dbIssues, []);

const filled = result.results.find(
  (item) => item.exchangeOrderId === "M38-ORDER-2",
);

assert.equal(filled.dbConsistent, true);
assert.equal(filled.fillCount, 1);

const inconsistent = result.results.find(
  (item) => item.exchangeOrderId === "M38-ORDER-3",
);

assert.equal(
  inconsistent.status,
  "DB_INCONSISTENCY",
);

assert.equal(
  inconsistent.dbConsistent,
  false,
);

assert.deepEqual(
  inconsistent.dbIssues,
  ["CYCLE_SYMBOL_MISMATCH"],
);

console.log("M38 DB + EXCHANGE RECONCILIATION: PASS");
console.log({
  checked: result.checked,
  consistent: result.consistent,
  discrepancies: result.discrepancies,
  dbInconsistencies: result.dbInconsistencies,
});
