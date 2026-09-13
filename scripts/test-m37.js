import assert from "node:assert/strict";
import tradingConfig from "../src/config/trading.config.js";
import ExchangeOrderFillMonitorService from "../src/services/exchangeOrderFillMonitorService.js";

const orders = new Map([
  [
    3701,
    {
      id: 3701,
      fill_processing_status: "EXHAUSTED",
      fill_processing_attempts: 5,
      fill_processing_error: "Maximum attempts reached",
    },
  ],
  [
    3702,
    {
      id: 3702,
      fill_processing_status: "PROCESSED",
      fill_processing_attempts: 3,
      fill_processing_error: null,
    },
  ],
  [
    3703,
    {
      id: 3703,
      fill_processing_status: "FAILED",
      fill_processing_attempts: 2,
      fill_processing_error: "Temporary failure",
    },
  ],
]);

const repository = {
  recoverCalls: 0,

  recoverFillProcessing(id) {
    this.recoverCalls += 1;

    const order = orders.get(id);

    if (!order) {
      return null;
    }

    if (order.fill_processing_status === "EXHAUSTED") {
      order.fill_processing_status = "FAILED";
      order.fill_processing_attempts = 0;
      order.fill_processing_error = null;
    }

    return order;
  },
};

const service = new ExchangeOrderFillMonitorService({
  mexcClient: {},
  exchangeOrderRepository: repository,
  fillRepository: {},
  tradingCycleExecutionService: {},
  cycleLifecycleService: {},
});

assert.equal(
  service.maxFillProcessingAttempts,
  tradingConfig.fillProcessing.maxAttempts,
);

const recovered =
  service.recoverExhaustedFillProcessing(
    orders.get(3701),
  );

assert.equal(recovered.recovered, true);
assert.equal(
  recovered.reason,
  "FILL_PROCESSING_RECOVERED",
);
assert.equal(
  recovered.processingStatus,
  "FAILED",
);
assert.equal(
  recovered.processingAttempts,
  0,
);

const processed =
  service.recoverExhaustedFillProcessing(
    orders.get(3702),
  );

assert.equal(processed.recovered, false);
assert.equal(
  processed.reason,
  "FILL_ALREADY_PROCESSED",
);

const notExhausted =
  service.recoverExhaustedFillProcessing(
    orders.get(3703),
  );

assert.equal(notExhausted.recovered, false);
assert.equal(
  notExhausted.reason,
  "FILL_PROCESSING_NOT_EXHAUSTED",
);

assert.equal(repository.recoverCalls, 1);

console.log("M37 EXHAUSTED FILL RECOVERY: PASS");
console.log({
  maxAttempts:
    service.maxFillProcessingAttempts,
  recovered:
    recovered.reason,
  resetAttempts:
    recovered.processingAttempts,
  processed:
    processed.reason,
  notExhausted:
    notExhausted.reason,
  recoveryCalls:
    repository.recoverCalls,
});
