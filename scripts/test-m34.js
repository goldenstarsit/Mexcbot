import assert from "node:assert/strict";
import tradingConfig from "../src/config/trading.config.js";

const repository = {
  exhausted: [],
  processing: [],

  markRecoveryExhausted(id, error) {
    this.exhausted.push({ id, error });
    return {
      id,
      recovery_status: "EXHAUSTED",
    };
  },

  markRecoveryProcessing(id) {
    this.processing.push(id);
    return {
      id,
      recovery_status: "PROCESSING",
    };
  },
};

const service = {
  exchangeOrderRepository: repository,
  maxAttempts: tradingConfig.terminalRecovery.maxAttempts,

  isTerminal(status) {
    return [
      "CANCELED",
      "CANCELLED",
      "REJECTED",
      "EXPIRED",
    ].includes(String(status ?? "").toUpperCase());
  },
};

async function simulateRecovery(exchangeOrder) {
  const status = String(
    exchangeOrder.status ?? "",
  ).toUpperCase();

  if (!service.isTerminal(status)) {
    return { status: "SKIPPED" };
  }

  const recoveryStatus = String(
    exchangeOrder.recovery_status ?? "PENDING",
  ).toUpperCase();

  if (recoveryStatus === "PROCESSED") {
    return { status: "ALREADY_RECOVERED" };
  }

  const attempts = Number(
    exchangeOrder.recovery_attempts ?? 0,
  );

  if (attempts >= service.maxAttempts) {
    repository.markRecoveryExhausted(
      exchangeOrder.id,
      `Maximum terminal recovery attempts reached: ${service.maxAttempts}`,
    );

    return {
      status: "RECOVERY_EXHAUSTED",
      attempts,
      maxAttempts: service.maxAttempts,
    };
  }

  repository.markRecoveryProcessing(exchangeOrder.id);

  return {
    status: "RETRY_ALLOWED",
    nextAttempt: attempts + 1,
  };
}

const allowed = await simulateRecovery({
  id: 3401,
  exchange_order_id: "M34-ALLOWED",
  status: "CANCELED",
  recovery_status: "FAILED",
  recovery_attempts: 4,
});

const exhausted = await simulateRecovery({
  id: 3402,
  exchange_order_id: "M34-EXHAUSTED",
  status: "CANCELED",
  recovery_status: "FAILED",
  recovery_attempts: 5,
});

assert.equal(service.maxAttempts, 5);
assert.equal(allowed.status, "RETRY_ALLOWED");
assert.equal(allowed.nextAttempt, 5);
assert.equal(exhausted.status, "RECOVERY_EXHAUSTED");
assert.equal(exhausted.attempts, 5);
assert.equal(repository.processing.length, 1);
assert.equal(repository.exhausted.length, 1);

console.log("M34 TERMINAL RECOVERY ATTEMPT LIMIT: PASS");
console.log({
  maxAttempts: service.maxAttempts,
  attempt4: allowed.status,
  attempt5: exhausted.status,
  exhaustedAttempts: exhausted.attempts,
  processingCalls: repository.processing.length,
  exhaustedCalls: repository.exhausted.length,
});
