import OrderIntentRecoveryRunner from "../src/services/orderIntentRecoveryRunner.js";

let calls = 0;
let activeCalls = 0;
let maximumConcurrentCalls = 0;

const recoveryService = {
  async recover() {
    calls += 1;
    activeCalls += 1;
    maximumConcurrentCalls = Math.max(
      maximumConcurrentCalls,
      activeCalls,
    );

    await new Promise((resolve) =>
      setTimeout(resolve, 50),
    );

    activeCalls -= 1;

    return {
      checked: 1,
      recovered: 1,
    };
  },
};

const runner =
  new OrderIntentRecoveryRunner({
    orderIntentRecoveryService:
      recoveryService,
    intervalMs: 20,
  });

const firstStart = runner.start();
const duplicateStart = runner.start();

if (!firstStart || duplicateStart || !runner.isRunning()) {
  throw new Error(
    "M39 runner start protection failed",
  );
}

const firstRun = runner.runOnce();
const concurrentRun = await runner.runOnce();

if (
  concurrentRun?.skipped !== true ||
  concurrentRun?.reason !==
    "ORDER_INTENT_RECOVERY_ALREADY_RUNNING"
) {
  throw new Error(
    `M39 concurrent recovery protection failed: ${JSON.stringify(
      concurrentRun,
    )}`,
  );
}

const firstResult = await firstRun;

if (
  firstResult?.recovered !== 1 ||
  maximumConcurrentCalls !== 1
) {
  throw new Error(
    `M39 recovery execution failed: ${JSON.stringify({
      firstResult,
      maximumConcurrentCalls,
    })}`,
  );
}

const firstStop = runner.stop();
const duplicateStop = runner.stop();

if (
  !firstStop ||
  duplicateStop ||
  runner.isRunning()
) {
  throw new Error(
    "M39 runner stop protection failed",
  );
}

console.log(
  "M39 ORDER INTENT RECOVERY RUNNER: PASS",
);

console.log({
  recoveryCalls: calls,
  maximumConcurrentRuns:
    maximumConcurrentCalls,
  duplicateStartProtected:
    duplicateStart === false,
  concurrentRunProtected:
    concurrentRun.skipped === true,
  duplicateStopProtected:
    duplicateStop === false,
});
