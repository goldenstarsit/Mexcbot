import assert from "node:assert/strict";
import tradingConfig from "../src/config/trading.config.js";
import ExchangeOrderFillMonitorService from "../src/services/exchangeOrderFillMonitorService.js";

const repository = {
  exhaustedCalls: 0,

  markFillProcessingExhausted(id, error) {
    this.exhaustedCalls += 1;

    return {
      id,
      fill_processing_status: "EXHAUSTED",
      fill_processing_attempts: 5,
      fill_processing_error: String(error),
    };
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

const attempt5 = await service.processOrder({
  exchangeOrder: {
    id: 3601,
    exchange_order_id: "M36-ATTEMPT-5",
    status: "FILLED",
    fill_processing_status: "FAILED",
    fill_processing_attempts: 5,
  },
  symbol: "BTCUSDT",
});

assert.equal(
  attempt5.reason,
  "FILL_PROCESSING_EXHAUSTED",
);

assert.equal(
  attempt5.processingStatus,
  "EXHAUSTED",
);

assert.equal(
  attempt5.processingAttempts,
  5,
);

const alreadyExhausted = await service.processOrder({
  exchangeOrder: {
    id: 3602,
    exchange_order_id: "M36-ALREADY-EXHAUSTED",
    status: "FILLED",
    fill_processing_status: "EXHAUSTED",
    fill_processing_attempts: 5,
  },
  symbol: "BTCUSDT",
});

assert.equal(
  alreadyExhausted.reason,
  "FILL_PROCESSING_EXHAUSTED",
);

assert.equal(repository.exhaustedCalls, 2);

console.log("M36 FILL PROCESSING SERVICE LIMIT: PASS");
console.log({
  configuredMaxAttempts:
    service.maxFillProcessingAttempts,
  attempt5: attempt5.reason,
  alreadyExhausted:
    alreadyExhausted.reason,
  exhaustedCalls:
    repository.exhaustedCalls,
});
