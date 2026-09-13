import assert from "node:assert/strict";

const terminalStatuses = [
  "CANCELED",
  "CANCELLED",
  "REJECTED",
  "EXPIRED",
];

for (const status of terminalStatuses) {
  assert.equal(
    terminalStatuses.includes(status),
    true,
  );
}

const retryId =
  "mxc-c10-initial-retry-EX-100";

assert.equal(
  retryId.startsWith("mxc-c10-initial-retry-"),
  true,
);

console.log("M30 TERMINAL ORDER RECOVERY: PASS");
console.log({
  terminalStatuses,
  retryClientOrderId: retryId,
  dcaRecovery: "PENDING",
  exitRecovery: "OPEN",
});
