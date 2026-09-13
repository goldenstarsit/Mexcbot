import assert from "node:assert/strict";
import TerminalOrderRecoveryRunner from "../src/services/terminalOrderRecoveryRunner.js";

let calls = 0;
let concurrent = 0;
let maximumConcurrent = 0;

const service = {
  async recover() {
    calls += 1;
    concurrent += 1;
    maximumConcurrent = Math.max(
      maximumConcurrent,
      concurrent,
    );

    await new Promise((resolve) =>
      setTimeout(resolve, 20),
    );

    concurrent -= 1;

    return {
      checked: 1,
      initialBuyRetried: 0,
      dcaReset: 1,
      exitsReset: 0,
      failed: 0,
    };
  },
};

const runner = new TerminalOrderRecoveryRunner({
  terminalOrderRecoveryService: service,
  intervalMs: 1000,
});

assert.equal(runner.isRunning(), false);
assert.equal(runner.start(), true);
assert.equal(runner.start(), false);
assert.equal(runner.isRunning(), true);

const firstRun = runner.runOnce();

await new Promise((resolve) =>
  setTimeout(resolve, 5),
);

const skipped = await runner.runOnce();

assert.equal(skipped.skipped, true);
assert.equal(
  skipped.reason,
  "TERMINAL_RECOVERY_ALREADY_RUNNING",
);

const result = await firstRun;

assert.equal(result.dcaReset, 1);
assert.equal(maximumConcurrent, 1);
assert.equal(runner.stop(), true);
assert.equal(runner.stop(), false);
assert.equal(runner.isRunning(), false);

console.log("M32 CONTINUOUS TERMINAL RECOVERY RUNNER: PASS");
console.log({
  recoveryRuns: calls,
  maximumConcurrentRuns: maximumConcurrent,
  duplicateStartProtected: true,
  concurrentRunProtected: true,
  duplicateStopProtected: true,
});
