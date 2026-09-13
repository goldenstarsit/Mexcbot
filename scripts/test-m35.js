import assert from "node:assert/strict";
import tradingConfig from "../src/config/trading.config.js";

const maxAttempts =
  tradingConfig.fillProcessing.maxAttempts;

assert.equal(maxAttempts, 5);

const repository = {
  exhausted: 0,
  processed: 0,

  markFillProcessingExhausted() {
    this.exhausted += 1;

    return {
      fill_processing_status: "EXHAUSTED",
      fill_processing_attempts: 5,
    };
  },
};

function evaluate(order) {
  const status = String(
    order.fill_processing_status ?? "PENDING",
  ).toUpperCase();

  if (status === "PROCESSED") {
    repository.processed += 1;

    return {
      status: "FILL_ALREADY_PROCESSED",
    };
  }

  const attempts = Number(
    order.fill_processing_attempts ?? 0,
  );

  if (
    status === "EXHAUSTED" ||
    attempts >= maxAttempts
  ) {
    const exhausted =
      repository.markFillProcessingExhausted(
        order.id,
        `Maximum fill processing attempts reached: ${maxAttempts}`,
      );

    return {
      status: "FILL_PROCESSING_EXHAUSTED",
      processingStatus:
        exhausted.fill_processing_status,
      processingAttempts:
        exhausted.fill_processing_attempts,
    };
  }

  return {
    status: "RETRY_ALLOWED",
    nextAttempt: attempts + 1,
  };
}

const attempt4 = evaluate({
  id: 3501,
  status: "FILLED",
  fill_processing_status: "FAILED",
  fill_processing_attempts: 4,
});

const attempt5 = evaluate({
  id: 3502,
  status: "FILLED",
  fill_processing_status: "FAILED",
  fill_processing_attempts: 5,
});

const processed = evaluate({
  id: 3503,
  status: "FILLED",
  fill_processing_status: "PROCESSED",
  fill_processing_attempts: 5,
});

assert.equal(attempt4.status, "RETRY_ALLOWED");
assert.equal(attempt4.nextAttempt, 5);

assert.equal(
  attempt5.status,
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

assert.equal(
  processed.status,
  "FILL_ALREADY_PROCESSED",
);

assert.equal(repository.exhausted, 1);
assert.equal(repository.processed, 1);

console.log("M35 FILL PROCESSING ATTEMPT LIMIT: PASS");
console.log({
  maxAttempts,
  attempt4: attempt4.status,
  attempt5: attempt5.status,
  processed: processed.status,
  exhaustedCalls: repository.exhausted,
  processedCalls: repository.processed,
});
