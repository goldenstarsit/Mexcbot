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
  VALUES ('BTCUSDT', 1, 'EXIT_PENDING', CURRENT_TIMESTAMP)
`).run();

function createSellIntent(clientOrderId) {
  return repo.create({
    tradingCycleId: Number(cycle.lastInsertRowid),
    symbol: "BTCUSDT",
    side: "SELL",
    orderType: "LIMIT_MAKER",
    price: 101,
    quantity: 0.01,
    clientOrderId,
    purpose: "exit",
  });
}

function expectTransitionFailure(label, action) {
  assert.throws(action, /Invalid order intent transition/);
  console.log(`Blocked: ${label}`);
}

// Normal SELL lifecycle.
const normal = createSellIntent("m66-normal");

assert.equal(normal.status, "PENDING");
assert.equal(normal.side, "SELL");
assert.equal(normal.purpose, "exit");

repo.markExchangePlaced(normal.id, "M66-SELL-1");
assert.equal(
  repo.findById(normal.id).status,
  "EXCHANGE_PLACED",
);

repo.markResolved(normal.id, "M66-SELL-1");

const resolvedNormal = repo.findById(normal.id);

assert.equal(resolvedNormal.status, "RESOLVED");
assert.equal(resolvedNormal.exchange_order_id, "M66-SELL-1");

// SELL recovery lifecycle.
const recovery = createSellIntent("m66-recovery");

repo.markRecoveryRequired(
  recovery.id,
  "simulated SELL exchange/DB boundary failure",
);

assert.equal(
  repo.findById(recovery.id).status,
  "RECOVERY_REQUIRED",
);

repo.markResolved(recovery.id, "M66-SELL-2");

assert.equal(
  repo.findById(recovery.id).status,
  "RESOLVED",
);

// Direct exchange recovery lifecycle.
const directRecovery = createSellIntent(
  "m66-direct-recovery",
);

repo.markResolved(
  directRecovery.id,
  "M66-SELL-3",
);

assert.equal(
  repo.findById(directRecovery.id).status,
  "RESOLVED",
);

// Permanent SELL failure.
const failed = createSellIntent("m66-failed");

repo.markFailed(
  failed.id,
  "simulated SELL placement failure",
);

assert.equal(
  repo.findById(failed.id).status,
  "FAILED",
);

// Terminal state protection.
expectTransitionFailure(
  "RESOLVED -> EXCHANGE_PLACED",
  () =>
    repo.markExchangePlaced(
      normal.id,
      "M66-SELL-LATE-1",
    ),
);

expectTransitionFailure(
  "RESOLVED -> RECOVERY_REQUIRED",
  () =>
    repo.markRecoveryRequired(
      normal.id,
      "late SELL failure",
    ),
);

expectTransitionFailure(
  "RESOLVED -> FAILED",
  () =>
    repo.markFailed(
      normal.id,
      "late SELL failure",
    ),
);

expectTransitionFailure(
  "FAILED -> EXCHANGE_PLACED",
  () =>
    repo.markExchangePlaced(
      failed.id,
      "M66-SELL-LATE-2",
    ),
);

expectTransitionFailure(
  "FAILED -> RECOVERY_REQUIRED",
  () =>
    repo.markRecoveryRequired(
      failed.id,
      "late SELL recovery",
    ),
);

expectTransitionFailure(
  "FAILED -> RESOLVED",
  () =>
    repo.markResolved(
      failed.id,
      "M66-SELL-LATE-3",
    ),
);

console.log("M66 SELL STATE MACHINE: PASS");
console.log({
  normalFlow:
    "PENDING -> EXCHANGE_PLACED -> RESOLVED",
  recoveryFlow:
    "PENDING -> RECOVERY_REQUIRED -> RESOLVED",
  directRecoveryFlow:
    "PENDING -> RESOLVED",
  failedFlow:
    "PENDING -> FAILED",
  terminalStatesProtected: true,
});
