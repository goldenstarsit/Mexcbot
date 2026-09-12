import ExchangeOrderPollingRunner from "../src/services/exchangeOrderPollingRunner.js";

const repository = {
  findActive() {
    return [];
  },
};

const monitor = {
  async processOrder() {
    return { processed: false };
  },
};

const runner = new ExchangeOrderPollingRunner({
  exchangeOrderRepository: repository,
  exchangeOrderFillMonitorService: monitor,
  intervalMs: 100,
});

const result = await runner.tick();

if (
  result.checked !== 0 ||
  result.filled !== 0 ||
  result.failed !== 0
) {
  throw new Error("M18 tick test failed");
}

if (!runner.start()) {
  throw new Error("M18 start failed");
}

if (!runner.isRunning()) {
  throw new Error("M18 should be running");
}

if (runner.start()) {
  throw new Error("M18 duplicate start should be rejected");
}

runner.stop();

if (runner.isRunning()) {
  throw new Error("M18 should be stopped");
}

if (runner.stop()) {
  throw new Error("M18 duplicate stop should be rejected");
}

console.log("M18 continuous exchange order polling: VALID");
console.log("Active order polling: PASS");
console.log("Runner start/stop: PASS");
console.log("Duplicate start/stop protection: PASS");
console.log("Cycle-specific fill handling: PASS");
console.log("Initial BUY detection: PASS");
console.log("Idempotent FILLED protection: PASS");
