import assert from "node:assert/strict";
import ExchangeOrphanOrderRecoveryRunner from "../src/services/exchangeOrphanOrderRecoveryRunner.js";

let recoveryCalls = 0;
let activeRuns = 0;
let maximumConcurrentRuns = 0;

const recoveryService = {
  async recover() {
    recoveryCalls += 1;
    activeRuns += 1;
    maximumConcurrentRuns = Math.max(
      maximumConcurrentRuns,
      activeRuns,
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    activeRuns -= 1;

    return {
      recovered: recoveryCalls,
    };
  },
};

const runner = new ExchangeOrphanOrderRecoveryRunner({
  exchangeOrphanOrderRecoveryService: recoveryService,
  intervalMs: 1000,
});

assert.equal(runner.isRunning(), false);
assert.equal(runner.start(), true);
assert.equal(runner.start(), false);
assert.equal(runner.isRunning(), true);

const first = runner.runOnce();
const second = await runner.runOnce();

assert.equal(
  second.skipped,
  true,
);

assert.equal(
  second.reason,
  "EXCHANGE_ORPHAN_RECOVERY_ALREADY_RUNNING",
);

await first;

assert.equal(recoveryCalls, 1);
assert.equal(maximumConcurrentRuns, 1);

assert.equal(runner.stop(), true);
assert.equal(runner.stop(), false);
assert.equal(runner.isRunning(), false);

console.log("M40 ORPHAN RECOVERY RUNNER: PASS");
console.log({
  recoveryCalls,
  maximumConcurrentRuns,
  duplicateStartProtected: true,
  concurrentRunProtected: true,
  duplicateStopProtected: true,
});
