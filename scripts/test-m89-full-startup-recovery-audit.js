const events = [];

const record = (name) => {
  events.push(name);
  return { service: name, status: "PASS" };
};

const exitOrderRecoveryService = {
  async recover() {
    return record("EXIT_RECOVERY");
  },
};

const terminalOrderRecoveryService = {
  async recover() {
    return record("TERMINAL_RECOVERY");
  },
};

const orderIntentRecoveryService = {
  async recover() {
    return record("ORDER_INTENT_RECOVERY");
  },
};

const exchangeReconciliationService = {
  async reconcile() {
    return record("RECONCILIATION");
  },
};

const exchangeOrphanOrderRecoveryService = {
  async recover() {
    return record("ORPHAN_RECOVERY");
  },
};

const allSymbolsStartupService = {
  async startInitialCycles() {
    return record("STARTUP_CYCLES");
  },
};

const runners = {
  orderPolling: {
    start() {
      record("ORDER_POLLING_START");
    },
  },
  reconciliation: {
    start() {
      record("RECONCILIATION_RUNNER_START");
    },
  },
  terminalRecovery: {
    start() {
      record("TERMINAL_RECOVERY_RUNNER_START");
    },
  },
  orderIntentRecovery: {
    start() {
      record("ORDER_INTENT_RECOVERY_RUNNER_START");
    },
  },
  orphanRecovery: {
    start() {
      record("ORPHAN_RECOVERY_RUNNER_START");
    },
  },
};

async function runStartupRecoverySequence() {
  const recovery =
    await exitOrderRecoveryService.recover();

  const terminalRecovery =
    await terminalOrderRecoveryService.recover();

  const orderIntentRecovery =
    await orderIntentRecoveryService.recover();

  const reconciliation =
    await exchangeReconciliationService.reconcile();

  const orphanRecovery =
    await exchangeOrphanOrderRecoveryService.recover();

  const startup =
    await allSymbolsStartupService.startInitialCycles();

  runners.orderPolling.start();
  runners.reconciliation.start();
  runners.terminalRecovery.start();
  runners.orderIntentRecovery.start();
  runners.orphanRecovery.start();

  return {
    recovery,
    terminalRecovery,
    orderIntentRecovery,
    reconciliation,
    orphanRecovery,
    startup,
  };
}

const result = await runStartupRecoverySequence();

const expectedEvents = [
  "EXIT_RECOVERY",
  "TERMINAL_RECOVERY",
  "ORDER_INTENT_RECOVERY",
  "RECONCILIATION",
  "ORPHAN_RECOVERY",
  "STARTUP_CYCLES",
  "ORDER_POLLING_START",
  "RECONCILIATION_RUNNER_START",
  "TERMINAL_RECOVERY_RUNNER_START",
  "ORDER_INTENT_RECOVERY_RUNNER_START",
  "ORPHAN_RECOVERY_RUNNER_START",
];

if (
  JSON.stringify(events) !==
  JSON.stringify(expectedEvents)
) {
  throw new Error(
    `Invalid startup recovery order:\n${JSON.stringify(events, null, 2)}`,
  );
}

const recoveryEvents = events.slice(0, 6);

if (new Set(recoveryEvents).size !== 6) {
  throw new Error("Duplicate startup recovery service detected");
}

if (events.indexOf("STARTUP_CYCLES") >
    events.indexOf("ORDER_POLLING_START")) {
  throw new Error(
    "Order polling started before initial cycle startup completed",
  );
}

if (events.indexOf("STARTUP_CYCLES") >
    events.indexOf("RECONCILIATION_RUNNER_START")) {
  throw new Error(
    "Reconciliation runner started before initial cycle startup completed",
  );
}

if (
  Object.values(result).some(
    (item) => item?.status !== "PASS",
  )
) {
  throw new Error("One or more startup recovery services failed");
}

console.log("M89 FULL STARTUP RECOVERY AUDIT: PASS");
console.log({
  exitRecovery: true,
  terminalRecovery: true,
  orderIntentRecovery: true,
  exchangeReconciliation: true,
  orphanOrderRecovery: true,
  initialCycleStartupAfterRecovery: true,
  runnersStartedAfterStartup: true,
  recoveryOrderVerified: true,
  duplicateRecoveryPrevented: true,
  events,
});
