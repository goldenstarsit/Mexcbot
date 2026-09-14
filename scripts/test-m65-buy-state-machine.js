import assert from "node:assert/strict";
import db from "../src/database/connection.js";
import OrderIntentRepository from "../src/database/repositories/OrderIntentRepository.js";

db.exec(`
  DELETE FROM order_intents;
  DELETE FROM dca_orders;
  DELETE FROM trading_cycles;
`);

const repo = new OrderIntentRepository();

const cycle = db.prepare(`
  INSERT INTO trading_cycles (
    symbol,
    cycle_number,
    status,
    created_at
  )
  VALUES ('BTCUSDT', 1, 'OPEN', CURRENT_TIMESTAMP)
`).run();

function createIntent(clientOrderId) {
  return repo.create({
    tradingCycleId: Number(cycle.lastInsertRowid),
    symbol: "BTCUSDT",
    side: "BUY",
    orderType: "LIMIT_MAKER",
    price: 100,
    quantity: 0.01,
    clientOrderId,
    purpose: "initial",
  });
}

const normal = createIntent("m65-normal");
assert.equal(normal.status, "PENDING");

repo.markExchangePlaced(normal.id, "M65-EX-1");
assert.equal(repo.findById(normal.id).status, "EXCHANGE_PLACED");

repo.markResolved(normal.id, "M65-EX-1");
assert.equal(repo.findById(normal.id).status, "RESOLVED");

const recovery = createIntent("m65-recovery");

repo.markRecoveryRequired(
  recovery.id,
  "simulated exchange/db boundary failure",
);
assert.equal(
  repo.findById(recovery.id).status,
  "RECOVERY_REQUIRED",
);

repo.markResolved(recovery.id, "M65-EX-2");
assert.equal(repo.findById(recovery.id).status, "RESOLVED");

const directRecovery = createIntent("m65-direct-recovery");

repo.markResolved(directRecovery.id, "M65-EX-3");
assert.equal(repo.findById(directRecovery.id).status, "RESOLVED");

const failed = createIntent("m65-failed");

repo.markFailed(failed.id, "insufficient capital");
assert.equal(repo.findById(failed.id).status, "FAILED");

console.log("M65 BUY STATE MACHINE BASELINE: PASS");
console.log({
  normalFlow: "PENDING -> EXCHANGE_PLACED -> RESOLVED",
  recoveryFlow: "PENDING -> RECOVERY_REQUIRED -> RESOLVED",
  directRecoveryFlow: "PENDING -> RESOLVED",
  failedFlow: "PENDING -> FAILED",
});

function expectTransitionFailure(label, action) {
  assert.throws(action, /Invalid order intent transition/);
  console.log(`Blocked: ${label}`);
}

const invalidResolved = createIntent("m65-invalid-resolved");
repo.markResolved(invalidResolved.id, "M65-EX-4");

expectTransitionFailure(
  "RESOLVED -> EXCHANGE_PLACED",
  () => repo.markExchangePlaced(invalidResolved.id, "M65-EX-5"),
);

expectTransitionFailure(
  "RESOLVED -> RECOVERY_REQUIRED",
  () => repo.markRecoveryRequired(invalidResolved.id, "late failure"),
);

expectTransitionFailure(
  "RESOLVED -> FAILED",
  () => repo.markFailed(invalidResolved.id, "late failure"),
);

const invalidFailed = createIntent("m65-invalid-failed");
repo.markFailed(invalidFailed.id, "insufficient capital");

expectTransitionFailure(
  "FAILED -> RESOLVED",
  () => repo.markResolved(invalidFailed.id, "M65-EX-6"),
);

expectTransitionFailure(
  "FAILED -> EXCHANGE_PLACED",
  () => repo.markExchangePlaced(invalidFailed.id, "M65-EX-7"),
);

expectTransitionFailure(
  "FAILED -> RECOVERY_REQUIRED",
  () => repo.markRecoveryRequired(invalidFailed.id, "late recovery"),
);

console.log("M65 INVALID TRANSITION TEST: PASS");
