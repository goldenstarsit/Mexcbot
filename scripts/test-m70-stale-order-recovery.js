import StaleOrderRecoveryService from "../src/services/staleOrderRecoveryService.js";

const now = Date.parse("2026-01-01T00:30:00.000Z");

const orders = [
  {
    id: 1,
    symbol: "BTCUSDT",
    exchange_order_id: "M70-STALE",
    client_order_id: "mxc-c1-dca-1",
    status: "NEW",
    created_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 2,
    symbol: "ETHUSDT",
    exchange_order_id: "M70-FRESH",
    client_order_id: "mxc-c1-dca-2",
    status: "NEW",
    created_at: "2026-01-01T00:25:00.000Z",
  },
  {
    id: 3,
    symbol: "BNBUSDT",
    exchange_order_id: "M70-PARTIAL",
    client_order_id: "mxc-c1-dca-3",
    status: "PARTIALLY_FILLED",
    created_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 4,
    symbol: "SOLUSDT",
    exchange_order_id: "M70-FILLED",
    client_order_id: "mxc-c1-dca-4",
    status: "FILLED",
    created_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 5,
    symbol: "TRXUSDT",
    exchange_order_id: "M70-CANCELED",
    client_order_id: "mxc-c1-dca-5",
    status: "CANCELED",
    created_at: "2026-01-01T00:00:00.000Z",
  },
];

const cancelCalls = [];

const exchangeOrderRepository = {
  findActive() {
    return orders;
  },
};

const cancelReplaceService = {
  async cancel(params) {
    cancelCalls.push(params);

    return {
      changed: true,
      reason: "ORDER_CANCELED",
    };
  },
};

const service = new StaleOrderRecoveryService({
  exchangeOrderRepository,
  cancelReplaceService,
  staleOrderAgeMs: 15 * 60 * 1000,
});

const result = await service.recover({ now });

if (result.checked !== 5) {
  throw new Error(`Expected 5 checked orders, got ${result.checked}`);
}

if (result.stale !== 2) {
  throw new Error(`Expected 2 stale orders, got ${result.stale}`);
}

if (result.recovered !== 2) {
  throw new Error(`Expected 2 recovered orders, got ${result.recovered}`);
}

if (result.failed !== 0) {
  throw new Error("Stale recovery must not fail");
}

if (cancelCalls.length !== 2) {
  throw new Error("Only stale active orders should be canceled");
}

const canceledIds = cancelCalls
  .map((call) => call.exchangeOrderId)
  .sort();

if (
  canceledIds[0] !== "M70-PARTIAL" ||
  canceledIds[1] !== "M70-STALE"
) {
  throw new Error("Unexpected stale orders were selected");
}

if (
  cancelCalls.some(
    (call) =>
      call.exchangeOrderId === "M70-FILLED" ||
      call.exchangeOrderId === "M70-CANCELED" ||
      call.exchangeOrderId === "M70-FRESH",
  )
) {
  throw new Error("Fresh or terminal orders must not be canceled");
}

const failedCancelService = {
  async cancel() {
    throw new Error("M70 simulated cancel failure");
  },
};

const failureService = new StaleOrderRecoveryService({
  exchangeOrderRepository,
  cancelReplaceService: failedCancelService,
  staleOrderAgeMs: 15 * 60 * 1000,
});

const failureResult = await failureService.recover({ now });

if (failureResult.stale !== 2) {
  throw new Error("Failure scenario must detect both stale orders");
}

if (failureResult.recovered !== 0) {
  throw new Error("Failed cancellations must not be reported recovered");
}

if (failureResult.failed !== 2) {
  throw new Error("Both stale cancellation failures must be recorded");
}

console.log("M70 STALE ORDER RECOVERY: PASS");
console.log({
  checked: result.checked,
  stale: result.stale,
  recovered: result.recovered,
  failed: result.failed,
  canceledExchangeOrders: canceledIds,
  failureHandling: {
    stale: failureResult.stale,
    recovered: failureResult.recovered,
    failed: failureResult.failed,
  },
});
