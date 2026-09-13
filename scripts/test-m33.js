import assert from "node:assert/strict";

import DcaOrderManager from "../src/services/dcaOrderManager.js";
import TerminalOrderRecoveryService from "../src/services/terminalOrderRecoveryService.js";
import CycleLifecycleService from "../src/services/cycleLifecycleService.js";

async function testDcaRetry() {
  const calls = [];

  const service = new TerminalOrderRecoveryService({
    tradingCycleRepository: {
      findById: () => ({ id: 10, status: "OPEN" }),
    },
    dcaOrderRepository: {
      findById: () => ({
        id: 55,
        trading_cycle_id: 10,
        status: "ORDER_PLACED",
      }),
      updateStatus: (id, status) => {
        assert.equal(id, 55);
        assert.equal(status, "PENDING");
      },
    },
    exchangeOrderRepository: {
      markRecoveryProcessing: () => {},
      markRecoveryProcessed: () => {
        calls.push("processed");
      },
      markRecoveryFailed: () => {
        calls.push("failed");
      },
      findByClientOrderId: (id) =>
        id === "old-dca-retry-EX-DCA-1"
          ? {
              exchange_order_id: "NEW-DCA-1",
              client_order_id: id,
            }
          : null,
    },
    tradingCycleExecutionService: {},
    cycleLifecycleService: {},
    duplicateProtectionService: {},
    dcaOrderManager: {
      retryDcaOrder: async (args) => {
        assert.equal(args.cycleId, 10);
        assert.equal(args.symbol, "BTCUSDT");
        assert.equal(args.dcaOrderId, 55);
        assert.equal(
          args.clientOrderId,
          "old-dca-retry-EX-DCA-1",
        );

        return {
          status: "ORDER_PLACED",
        };
      },
    },
    fillRepository: {},
  });

  const result = await service.recoverOrder({
    id: 100,
    trading_cycle_id: 10,
    symbol: "BTCUSDT",
    side: "BUY",
    dca_order_id: 55,
    exchange_order_id: "EX-DCA-1",
    client_order_id: "old-dca",
    status: "CANCELED",
    recovery_status: "PENDING",
  });

  assert.equal(result.status, "DCA_RETRIED");
  assert.equal(result.retryExchangeOrderId, "NEW-DCA-1");
  assert.deepEqual(calls, ["processed"]);
}

async function testDcaTargetNotReached() {
  const calls = [];

  const service = new TerminalOrderRecoveryService({
    tradingCycleRepository: {},
    dcaOrderRepository: {
      findById: () => ({ id: 55 }),
      updateStatus: () => {},
    },
    exchangeOrderRepository: {
      markRecoveryProcessing: () => {},
      markRecoveryProcessed: () => {
        calls.push("processed");
      },
      markRecoveryFailed: () => {
        calls.push("failed");
      },
      findByClientOrderId: () => null,
    },
    tradingCycleExecutionService: {},
    cycleLifecycleService: {},
    duplicateProtectionService: {},
    dcaOrderManager: {
      retryDcaOrder: async () => [
        {
          status: "WAITING",
          reason: "Price has not reached DCA target",
        },
      ],
    },
    fillRepository: {},
  });

  const result = await service.recoverOrder({
    id: 101,
    trading_cycle_id: 10,
    symbol: "BTCUSDT",
    side: "BUY",
    dca_order_id: 55,
    exchange_order_id: "EX-DCA-2",
    client_order_id: "old-dca",
    status: "EXPIRED",
    recovery_status: "PENDING",
  });

  assert.equal(result.status, "DCA_RETRY_WAITING");
  assert.deepEqual(calls, ["failed"]);
}

async function testSellRetry() {
  const calls = [];

  const lifecycle = new CycleLifecycleService({
    tradingCycleRepository: {
      findById: () => ({
        id: 20,
        status: "EXIT_PENDING",
      }),
      updateStatus: (id, status) => {
        assert.equal(id, 20);
        assert.equal(status, "OPEN");
      },
      reserveExit: () => ({
        reserved: true,
        cycle: {
          id: 20,
          status: "EXIT_PENDING",
        },
      }),
    },
    exchangeOrderRepository: {
      findActiveSellByCycleId: () => null,
      findByClientOrderId: (id) =>
        id === "mxc-c20-sl-retry-EX-SL-1"
          ? {
              exchange_order_id: "NEW-SL-1",
              client_order_id: id,
            }
          : null,
    },
    fillRepository: {},
    positionCalculator: {
      calculate: () => ({
        totalQuantity: 0.01,
      }),
    },
    marketPriceService: {
      get: async () => ({
        askPrice: 100,
        bidPrice: 99,
      }),
    },
    makerOrderEngine: {},
    quantityCalculator: {
      calculateSellQuantity: () => 0.01,
    },
    symbolRulesService: {
      get: async () => ({
        stepSize: 0.00001,
        minQty: 0.00001,
        minNotional: 1,
      }),
    },
    duplicateProtectionService: {
      createClientOrderId: () => "mxc-c20-sl",
      placeSell: async (args) => {
        assert.equal(
          args.clientOrderId,
          "mxc-c20-sl-retry-EX-SL-1",
        );
        assert.equal(args.reason, "STOP_LOSS");

        return {
          exchangeOrder: {
            exchange_order_id: "NEW-SL-1",
            client_order_id: args.clientOrderId,
          },
          reused: false,
        };
      },
    },
    triggerInitialOrder: null,
  });

  const recovery = new TerminalOrderRecoveryService({
    tradingCycleRepository: {
      findById: () => ({
        id: 20,
        status: "EXIT_PENDING",
      }),
      updateStatus: (id, status) => {
        assert.equal(id, 20);
        assert.equal(status, "OPEN");
      },
    },
    dcaOrderRepository: {},
    exchangeOrderRepository: {
      markRecoveryProcessing: () => {},
      markRecoveryProcessed: () => {
        calls.push("processed");
      },
      markRecoveryFailed: () => {
        calls.push("failed");
      },
      findByClientOrderId: (id) =>
        id === "mxc-c20-sl-retry-EX-SL-1"
          ? {
              exchange_order_id: "NEW-SL-1",
              client_order_id: id,
            }
          : null,
    },
    tradingCycleExecutionService: {},
    cycleLifecycleService: lifecycle,
    duplicateProtectionService: {},
    dcaOrderManager: {},
    fillRepository: {
      findByCycleId: () => [
        {
          side: "BUY",
          quantity: 0.01,
          price: 90,
        },
      ],
    },
  });

  const result = await recovery.recoverOrder({
    id: 102,
    trading_cycle_id: 20,
    symbol: "BTCUSDT",
    side: "SELL",
    dca_order_id: null,
    exchange_order_id: "EX-SL-1",
    client_order_id: "mxc-c20-sl",
    status: "CANCELED",
    recovery_status: "PENDING",
  });

  assert.equal(result.status, "EXIT_RETRIED");
  assert.equal(result.retryExchangeOrderId, "NEW-SL-1");
  assert.deepEqual(calls, ["processed"]);
}

async function testDcaManagerRetryClientId() {
  let placedClientId = null;

  const manager = new DcaOrderManager({
    dcaOrderRepository: {
      findPendingByCycleId: async () => [
        {
          id: 55,
          target_price: 90,
          quantity: 0.02,
        },
      ],
      updateStatus: async () => {},
    },
    dcaCalculator: {},
    quantityCalculator: {},
    makerOrderEngine: {},
    marketPriceService: {
      get: async () => ({
        price: 90,
        askPrice: 91,
      }),
    },
    symbolRulesService: {
      get: async () => ({}),
    },
    exchangeOrderRepository: {},
    duplicateProtectionService: {
      placeBuy: async (args) => {
        placedClientId = args.clientOrderId;
        return {
          exchangeOrder: {
            exchange_order_id: "NEW-DCA-55",
          },
        };
      },
    },
  });

  const result = await manager.retryDcaOrder({
    cycleId: 10,
    symbol: "BTCUSDT",
    dcaOrderId: 55,
    clientOrderId: "mxc-c10-dca-55-retry-EX-55",
  });

  assert.equal(result[0].status, "ORDER_PLACED");
  assert.equal(
    placedClientId,
    "mxc-c10-dca-55-retry-EX-55",
  );
}

await testDcaRetry();
await testDcaTargetNotReached();
await testSellRetry();
await testDcaManagerRetryClientId();

console.log("M33 TERMINAL DCA/EXIT RETRY EXECUTION: PASS");
console.log({
  dcaRetry: "PLACED",
  dcaTargetNotReached: "FAILED_RECOVERY_RETRYABLE",
  stopLossRetry: "PLACED",
  retryClientIds: "VERIFIED",
});
