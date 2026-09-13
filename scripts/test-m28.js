import ExchangeReconciliationRunner from "../src/services/exchangeReconciliationRunner.js";

let calls = 0;
let concurrentCalls = 0;
let maximumConcurrentCalls = 0;

const reconciliationService = {
  async reconcile() {
    calls += 1;
    concurrentCalls += 1;
    maximumConcurrentCalls = Math.max(
      maximumConcurrentCalls,
      concurrentCalls,
    );

    await new Promise((resolve) => setTimeout(resolve, 40));

    concurrentCalls -= 1;

    return {
      checked: 1,
      consistent: 1,
      discrepancies: 0,
      failed: 0,
    };
  },
};

const runner = new ExchangeReconciliationRunner({
  exchangeReconciliationService: reconciliationService,
  intervalMs: 20,
});

if (runner.isRunning()) {
  throw new Error("Runner should initially be stopped");
}

if (!runner.start()) {
  throw new Error("First start should succeed");
}

if (runner.start()) {
  throw new Error("Second start should be ignored");
}

if (!runner.isRunning()) {
  throw new Error("Runner should be running");
}

const firstRun = runner.runOnce();

await new Promise((resolve) => setTimeout(resolve, 5));

const skipped = await runner.runOnce();

if (
  !skipped.skipped ||
  skipped.reason !== "RECONCILIATION_ALREADY_RUNNING"
) {
  throw new Error("Concurrent reconciliation protection failed");
}

await firstRun;

await new Promise((resolve) => setTimeout(resolve, 90));

if (calls === 0) {
  throw new Error("Scheduled reconciliation never ran");
}

if (maximumConcurrentCalls !== 1) {
  throw new Error(
    `Concurrent reconciliation detected: ${maximumConcurrentCalls}`,
  );
}

if (!runner.stop()) {
  throw new Error("Stop should succeed");
}

if (runner.stop()) {
  throw new Error("Second stop should be ignored");
}

if (runner.isRunning()) {
  throw new Error("Runner should be stopped");
}

console.log("M28 RECONCILIATION RUNNER: PASS");
console.log({
  reconciliationRuns: calls,
  maximumConcurrentRuns: maximumConcurrentCalls,
  duplicateStartProtected: true,
  concurrentRunProtected: true,
  duplicateStopProtected: true,
});
