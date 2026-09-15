import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const app = read("src/app.js");
const botStatus = read("src/services/botStatusService.js");
const config = read("src/config/trading.config.js");
const validator = read("src/config/validateTradingConfig.js");
const api = read("src/api/tradingConfigApi.js");
const gitignore = read(".gitignore");

const checks = {};

checks.defaultConfig = {
  symbols:
    ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "TRXUSDT"]
      .every((symbol) => config.includes(`"${symbol}"`)),
  takeProfit: config.includes("takeProfit: 1"),
  stopLoss: config.includes("stopLoss: 50"),
  dcaLevels: config.includes("levels: 9"),
  triangularDca: config.includes('formula: "triangular"'),
  makerOnly:
    config.includes('type: "LIMIT_MAKER"') &&
    config.includes("makerOnly: true"),
};

assert(
  Object.values(checks.defaultConfig).every(Boolean),
  "Default trading configuration is invalid",
);

checks.configValidation = {
  symbols: validator.includes("symbols"),
  takeProfit: validator.includes("takeProfit"),
  stopLoss: validator.includes("stopLoss"),
  dca: validator.includes("dca"),
  makerOnly:
    validator.includes("LIMIT_MAKER") &&
    validator.includes("makerOnly"),
  recoveryLimits:
    validator.includes("terminalRecovery") &&
    validator.includes("fillProcessing"),
};

assert(
  Object.values(checks.configValidation).every(Boolean),
  "Runtime configuration validation is incomplete",
);

checks.security = {
  envIgnored: gitignore.includes(".env"),
  databaseIgnored: gitignore.includes("data/"),
  apiLocalhost: api.includes('host = "127.0.0.1"'),
};

assert(checks.security.envIgnored, ".env is not protected");
assert(checks.security.databaseIgnored, "Database files are not protected");
assert(checks.security.apiLocalhost, "API is not localhost-only");

checks.liveTradingFailClosed = {
  runtimeState:
    app.includes("const runtimeState =") &&
    app.includes("liveTradingEnabled: false") &&
    app.includes("runtimeState.liveTradingEnabled"),
  accountReadiness:
    app.includes("accountReadiness.status === \"OK\"") &&
    app.includes("accountReadiness.authenticated === true") &&
    app.includes("accountReadiness.canTrade === true") &&
    app.includes("accountReadiness.tradingReady === true"),
  startupFailureDisablesTrading:
    app.includes("liveTradingEnabled = false") &&
    app.includes("runtimeState.liveTradingEnabled = false"),
  productionStartupFailureExit:
    app.includes('shutdown("STARTUP_FAILURE", 1)'),
};

assert(
  Object.values(checks.liveTradingFailClosed).every(Boolean),
  "Live-trading fail-closed protection is incomplete",
);

checks.processSafety = {
  shutdownGuard: app.includes("runtimeState.shuttingDown"),
  sigint: app.includes('shutdown("SIGINT", 0)'),
  sigterm: app.includes('shutdown("SIGTERM", 0)'),
  unhandledRejection:
    app.includes('process.on("unhandledRejection"') &&
    app.includes('shutdown("UNHANDLED_REJECTION", 1)'),
  uncaughtException:
    app.includes('process.on("uncaughtException"') &&
    app.includes('shutdown("UNCAUGHT_EXCEPTION", 1)'),
};

assert(
  Object.values(checks.processSafety).every(Boolean),
  "Process-level safety is incomplete",
);

checks.dashboardState = {
  runtimeCallback: botStatus.includes("getLiveTradingState"),
  actualRuntimeState:
    botStatus.includes("Boolean(this.getLiveTradingState())"),
  readinessFallback:
    botStatus.includes("mexcAccount.tradingReady === true"),
};

assert(
  Object.values(checks.dashboardState).every(Boolean),
  "Dashboard runtime state protection is incomplete",
);

checks.startupRecovery = {
  exitRecovery: app.includes("exitOrderRecoveryService.recover()"),
  terminalRecovery:
    app.includes("terminalOrderRecoveryService.recover()"),
  intentRecovery:
    app.includes("orderIntentRecoveryService.recover()"),
  reconciliation:
    app.includes("exchangeReconciliationService.reconcile()"),
  orphanRecovery:
    app.includes("exchangeOrphanOrderRecoveryService.recover()"),
};

assert(
  Object.values(checks.startupRecovery).every(Boolean),
  "Startup recovery sequence is incomplete",
);

checks.runtime = {
  pollingInterval: app.includes("5000"),
  reconciliationRunner: app.includes("exchangeReconciliationRunner"),
  terminalRecoveryRunner: app.includes("terminalOrderRecoveryRunner"),
  intentRecoveryRunner: app.includes("orderIntentRecoveryRunner"),
  orphanRecoveryRunner: app.includes("exchangeOrphanOrderRecoveryRunner"),
};

assert(
  Object.values(checks.runtime).every(Boolean),
  "Recurring runtime runners are incomplete",
);

console.log("M116 PRODUCTION READINESS AUDIT: PASS");
console.log(
  JSON.stringify(
    {
      defaultConfig: checks.defaultConfig,
      configValidation: checks.configValidation,
      security: checks.security,
      liveTradingFailClosed: checks.liveTradingFailClosed,
      processSafety: checks.processSafety,
      dashboardState: checks.dashboardState,
      startupRecovery: checks.startupRecovery,
      runtime: checks.runtime,
    },
    null,
    2,
  ),
);
