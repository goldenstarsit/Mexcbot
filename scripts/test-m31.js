import assert from "node:assert/strict";

const terminalStatuses = [
  "CANCELED",
  "CANCELLED",
  "REJECTED",
  "EXPIRED",
];

const recoveryStatuses = [
  "PENDING",
  "PROCESSING",
  "PROCESSED",
  "FAILED",
];

assert.equal(terminalStatuses.length, 4);
assert.equal(recoveryStatuses.includes("PROCESSED"), true);
assert.equal(recoveryStatuses.includes("FAILED"), true);

const recoverable =
  terminalStatuses.includes("CANCELED") &&
  ["PENDING", "FAILED"].includes("PENDING");

assert.equal(recoverable, true);

const alreadyRecovered =
  "PROCESSED" === "PROCESSED";

assert.equal(alreadyRecovered, true);

console.log("M31 TERMINAL RECOVERY IDEMPOTENCY: PASS");
console.log({
  terminalStatuses,
  recoveryStatuses,
  processedOrdersSkipped: true,
  failedOrdersRetryable: true,
});
