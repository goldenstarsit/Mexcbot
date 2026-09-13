import assert from "node:assert/strict";
import ExchangeOrphanOrderRecoveryService from "../src/services/exchangeOrphanOrderRecoveryService.js";

let mode = "invalid";
let createCalls = 0;

const service = new ExchangeOrphanOrderRecoveryService({
  mexcClient: {
    async getOpenOrders(symbol) {
      if (mode === "failure") {
        throw new Error(`M40 ${symbol} API failure`);
      }

      return [
        {
          orderId: "",
          origClientOrderId: "mxc-c101-initial",
          symbol,
          side: "BUY",
          type: "LIMIT_MAKER",
          price: "100",
          origQty: "1",
          status: "NEW",
        },
        {
          orderId: "M40-UNRESOLVED",
          origClientOrderId: "unknown-client",
          symbol,
          side: "BUY",
          type: "LIMIT_MAKER",
          price: "100",
          origQty: "1",
          status: "NEW",
        },
      ];
    },
  },

  tradingConfig: {
    symbols: ["BTCUSDT"],
  },

  exchangeOrderRepository: {
    findByExchangeOrderId() {
      return null;
    },

    create(data) {
      createCalls += 1;
      return {
        id: createCalls,
        ...data,
      };
    },
  },

  tradingCycleRepository: {
    findById() {
      return null;
    },
  },

  dcaOrderRepository: {
    findById() {
      return null;
    },
  },
});

let result = await service.recover();

assert.equal(result.checkedSymbols, 1);
assert.equal(result.checkedOrders, 2);
assert.equal(result.recovered, 0);
assert.equal(result.unresolved, 1);
assert.equal(result.results[0].invalid, 1);

mode = "failure";

result = await service.recover();

assert.equal(result.checkedSymbols, 1);
assert.equal(result.checkedOrders, 0);
assert.equal(result.failedSymbols, 1);
assert.equal(
  result.results[0].status,
  "EXCHANGE_CHECK_FAILED",
);

console.log("M40 EDGE CASES: PASS");
console.log({
  invalidRemoteOrders: 1,
  unresolvedOrders: 1,
  failedSymbols: result.failedSymbols,
});
