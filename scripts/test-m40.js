import assert from "node:assert/strict";
import ExchangeOrphanOrderRecoveryService from "../src/services/exchangeOrphanOrderRecoveryService.js";

const localOrders = new Map();

const exchangeOrderRepository = {
  findByExchangeOrderId(exchangeOrderId) {
    return localOrders.get(exchangeOrderId) ?? null;
  },

  create(data) {
    const order = {
      id: localOrders.size + 1,
      ...data,
    };

    localOrders.set(order.exchangeOrderId, order);
    return order;
  },
};

const tradingCycleRepository = {
  findById(id) {
    if (id === 101) {
      return {
        id: 101,
        symbol: "BTCUSDT",
        cycle_number: 1,
        status: "OPEN",
      };
    }

    return null;
  },
};

const dcaOrderRepository = {
  findById(id) {
    if (id === 501) {
      return {
        id: 501,
        trading_cycle_id: 101,
        symbol: "BTCUSDT",
        order_number: 1,
        status: "PENDING",
      };
    }

    return null;
  },
};

const mexcClient = {
  async getOpenOrders(symbol) {
    if (symbol === "BTCUSDT") {
      return [
        {
          orderId: "M40-REMOTE-1",
          origClientOrderId: "mxc-c101-initial",
          symbol: "BTCUSDT",
          side: "BUY",
          type: "LIMIT_MAKER",
          price: "95000",
          origQty: "0.00002",
          status: "NEW",
        },
        {
          orderId: "M40-REMOTE-2",
          origClientOrderId: "mxc-c101-dca-501",
          symbol: "BTCUSDT",
          side: "BUY",
          type: "LIMIT_MAKER",
          price: "94000",
          origQty: "0.00002",
          status: "NEW",
        },
        {
          orderId: "M40-REMOTE-3",
          origClientOrderId: "unknown-client-id",
          symbol: "BTCUSDT",
          side: "BUY",
          type: "LIMIT_MAKER",
          price: "93000",
          origQty: "0.00002",
          status: "NEW",
        },
      ];
    }

    if (symbol === "ETHUSDT") {
      return [
        {
          orderId: "M40-LOCAL-1",
          origClientOrderId: "mxc-c101-initial",
          symbol: "ETHUSDT",
          side: "BUY",
          type: "LIMIT_MAKER",
          price: "3000",
          origQty: "0.001",
          status: "NEW",
        },
      ];
    }

    return [];
  },
};

localOrders.set("M40-LOCAL-1", {
  id: 99,
  exchange_order_id: "M40-LOCAL-1",
});

const service = new ExchangeOrphanOrderRecoveryService({
  mexcClient,
  tradingConfig: {
    symbols: [
      "BTCUSDT",
      "ETHUSDT",
      "SOLUSDT",
    ],
  },
  exchangeOrderRepository,
  tradingCycleRepository,
  dcaOrderRepository,
});

const result = await service.recover();

assert.equal(result.checkedSymbols, 3);
assert.equal(result.checkedOrders, 4);
assert.equal(result.recovered, 2);
assert.equal(result.unresolved, 1);
assert.equal(result.failedSymbols, 0);

assert.ok(
  localOrders.has("M40-REMOTE-1"),
  "Initial orphan was not recovered",
);

assert.ok(
  localOrders.has("M40-REMOTE-2"),
  "DCA orphan was not recovered",
);

const btc = result.results.find(
  (item) => item.symbol === "BTCUSDT",
);

assert.equal(btc.alreadyRecorded, 0);
assert.equal(btc.recovered, 2);
assert.equal(btc.unresolved, 1);

console.log("M40 EXCHANGE ORPHAN ORDER RECOVERY: PASS");
console.log({
  checkedSymbols: result.checkedSymbols,
  checkedOrders: result.checkedOrders,
  recovered: result.recovered,
  unresolved: result.unresolved,
  failedSymbols: result.failedSymbols,
});
