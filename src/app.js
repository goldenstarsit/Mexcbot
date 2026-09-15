import "dotenv/config";

import tradingConfig from "./config/trading.config.js";
import { validateTradingConfig } from "./config/validateTradingConfig.js";

import db from "./database/connection.js";
import "./database/migrations/index.js";

import MexcClient from "./exchange/mexcClient.js";
import MarketPriceService from "./exchange/marketPriceService.js";
import MexcSymbolRules from "./exchange/mexcSymbolRules.js";
import MexcHealthService from "./services/mexcHealthService.js";
import MexcAccountHealthService from "./services/mexcAccountHealthService.js";

import TradingCycleRepository from "./database/repositories/tradingCycleRepository.js";
import RuntimeTradingConfigRepository from "./database/repositories/runtimeTradingConfigRepository.js";
import TradingConfigService from "./services/tradingConfigService.js";
import TradingConfigApi from "./api/tradingConfigApi.js";
import DcaOrderRepository from "./database/repositories/dcaOrderRepository.js";
import ExchangeOrderRepository from "./database/repositories/exchangeOrderRepository.js";
import OrderIntentRepository from "./database/repositories/OrderIntentRepository.js";
import FillRepository from "./database/repositories/fillRepository.js";

import DcaCalculator from "./services/dcaCalculator.js";
import QuantityCalculator from "./services/quantityCalculator.js";
import MakerOrderEngine from "./services/makerOrderEngine.js";
import DuplicateProtectionService from "./services/duplicateProtectionService.js";
import TradingCapitalGuard from "./services/tradingCapitalGuard.js";
import TradingCapitalReservationService from "./services/tradingCapitalReservationService.js";
import DcaOrderManager from "./services/dcaOrderManager.js";
import PositionCalculator from "./services/positionCalculator.js";
import PositionProtectionService from "./services/positionProtectionService.js";
import OpenPositionDashboardService from "./services/openPositionDashboardService.js";
import TradingCycleExecutionService from "./services/tradingCycleExecutionService.js";
import CycleLifecycleService from "./services/cycleLifecycleService.js";
import AllSymbolsStartupService from "./services/allSymbolsStartupService.js";
import ExchangeOrderFillMonitorService from "./services/exchangeOrderFillMonitorService.js";
import ExchangeOrderPollingRunner from "./services/exchangeOrderPollingRunner.js";
import ExitOrderRecoveryService from "./services/exitOrderRecoveryService.js";
import ExchangeReconciliationService from "./services/exchangeReconciliationService.js";
import ExchangeReconciliationRunner from "./services/exchangeReconciliationRunner.js";
import BotStatusService from "./services/botStatusService.js";
import TerminalOrderRecoveryService from "./services/terminalOrderRecoveryService.js";
import TerminalOrderRecoveryRunner from "./services/terminalOrderRecoveryRunner.js";
import OrderIntentRecoveryService from "./services/orderIntentRecoveryService.js";
import OrderIntentRecoveryRunner from "./services/orderIntentRecoveryRunner.js";
import ExchangeOrphanOrderRecoveryService from "./services/exchangeOrphanOrderRecoveryService.js";
import ExchangeOrphanOrderRecoveryRunner from "./services/exchangeOrphanOrderRecoveryRunner.js";

validateTradingConfig(tradingConfig);

const runtimeTradingConfigRepository =
  new RuntimeTradingConfigRepository();

const tradingConfigService =
  new TradingConfigService({
    runtimeTradingConfigRepository,
    defaultConfig: tradingConfig,
  });

const runtimeConfig =
  tradingConfigService.initialize();

validateTradingConfig(runtimeConfig.config);

const mexcClient = new MexcClient();
const marketPriceService = new MarketPriceService(mexcClient);
const symbolRulesService = new MexcSymbolRules(mexcClient);
const mexcHealthService = new MexcHealthService({
  mexcClient,
  tradingConfigService,
});

const mexcAccountHealthService =
  new MexcAccountHealthService({
    mexcClient,
  });

const tradingCycleRepository = new TradingCycleRepository();

const dcaOrderRepository = new DcaOrderRepository();
const exchangeOrderRepository = new ExchangeOrderRepository();
const orderIntentRepository = new OrderIntentRepository();
const fillRepository = new FillRepository();

const dcaCalculator = new DcaCalculator(tradingConfig);
const quantityCalculator = new QuantityCalculator(1);

const tradingCapitalGuard = new TradingCapitalGuard();
const tradingCapitalReservationService = new TradingCapitalReservationService();

const makerOrderEngine = new MakerOrderEngine(
  mexcClient,
  tradingConfig,
);

const duplicateProtectionService =
  new DuplicateProtectionService({
    mexcClient,
    exchangeOrderRepository,
    makerOrderEngine,
    orderIntentRepository,
    tradingCapitalGuard,
    tradingCapitalReservationService,
    mexcAccountHealthService,
  });

const dcaOrderManager = new DcaOrderManager({
  dcaOrderRepository,
  dcaCalculator,
  quantityCalculator,
  makerOrderEngine,
  marketPriceService,
  symbolRulesService,
  exchangeOrderRepository,
  duplicateProtectionService,
});

const positionCalculator = new PositionCalculator();

const positionProtectionService = new PositionProtectionService({
  positionCalculator,
  dcaCalculator,
  quantityCalculator,
  symbolRulesService,
  tradingConfig,
});

const openPositionDashboardService =
  new OpenPositionDashboardService({
    tradingCycleRepository,
    fillRepository,
    positionCalculator,
    positionProtectionService,
  });

const tradingCycleExecutionService =
  new TradingCycleExecutionService({
    tradingCycleRepository,
    dcaOrderManager,
    dcaOrderRepository,
    exchangeOrderRepository,
    fillRepository,
    marketPriceService,
    symbolRulesService,
    quantityCalculator,
    makerOrderEngine,
    duplicateProtectionService,
    positionProtectionService,
  });

const cycleLifecycleService = new CycleLifecycleService({
  tradingCycleRepository,
  exchangeOrderRepository,
  fillRepository,
  positionCalculator,
  marketPriceService,
  makerOrderEngine,
  quantityCalculator,
  symbolRulesService,
  duplicateProtectionService,
  tradingConfigService,
  triggerInitialOrder: (params) =>
    tradingCycleExecutionService.triggerInitialOrder(params),
});

const exchangeOrderFillMonitorService =
  new ExchangeOrderFillMonitorService({
    mexcClient,
    exchangeOrderRepository,
    fillRepository,
    tradingCycleExecutionService,
    cycleLifecycleService,
    tradingConfigService,
  });

const pollingRunner = new ExchangeOrderPollingRunner({
  exchangeOrderRepository,
  exchangeOrderFillMonitorService,
  intervalMs: 5000,
});

const exitOrderRecoveryService =
  new ExitOrderRecoveryService({
    tradingCycleRepository,
    exchangeOrderRepository,
    duplicateProtectionService,
  });

const allSymbolsStartupService =
  new AllSymbolsStartupService({
    tradingConfig,
    tradingConfigService,
    marketPriceService,
    tradingCycleRepository,
    tradingCycleExecutionService,
  });

const exchangeReconciliationService =
  new ExchangeReconciliationService({
    mexcClient,
    exchangeOrderRepository,
    exchangeOrderFillMonitorService,
    tradingCycleRepository,
    dcaOrderRepository,
    fillRepository,
  });

const terminalOrderRecoveryService =
  new TerminalOrderRecoveryService({
    tradingCycleRepository,
    dcaOrderRepository,
    exchangeOrderRepository,
    tradingCycleExecutionService,
    cycleLifecycleService,
    duplicateProtectionService,
    dcaOrderManager,
    fillRepository,
    tradingConfigService,
  });

const terminalOrderRecoveryRunner =
  new TerminalOrderRecoveryRunner({
    terminalOrderRecoveryService,
    intervalMs: 60000,
  });

const orderIntentRecoveryService =
  new OrderIntentRecoveryService({
    orderIntentRepository,
    exchangeOrderRepository,
    mexcClient,
  });

const orderIntentRecoveryRunner =
  new OrderIntentRecoveryRunner({
    orderIntentRecoveryService,
    intervalMs: 60000,
  });

const exchangeOrphanOrderRecoveryService =
  new ExchangeOrphanOrderRecoveryService({
    mexcClient,
    tradingConfig,
    tradingConfigService,
    exchangeOrderRepository,
    tradingCycleRepository,
    dcaOrderRepository,
  });

const exchangeOrphanOrderRecoveryRunner =
  new ExchangeOrphanOrderRecoveryRunner({
    exchangeOrphanOrderRecoveryService,
    intervalMs: 60000,
  });

const exchangeReconciliationRunner =
  new ExchangeReconciliationRunner({
    exchangeReconciliationService,
    intervalMs: 60000,
  });

const botStatusService = new BotStatusService({
  tradingConfigService,
  tradingCycleRepository,
  mexcHealthService,
  mexcAccountHealthService,
  db,
  runners: {
    orderPolling: pollingRunner,
    reconciliation: exchangeReconciliationRunner,
    terminalRecovery: terminalOrderRecoveryRunner,
    orderIntentRecovery: orderIntentRecoveryRunner,
    orphanRecovery: exchangeOrphanOrderRecoveryRunner,
  },
});

const tradingConfigApi =
  new TradingConfigApi({
    tradingConfigService,
    tradingCycleRepository,
    exchangeOrderRepository,
    openPositionDashboardService,
    botStatusService,
    host: "127.0.0.1",
    port: 3000,
  });

tradingConfigApi.start();

console.log(
  "[ConfigAPI] Listening: http://127.0.0.1:3000/api/config",
);

console.log("MEXCBOT");
console.log("Environment:", process.env.NODE_ENV);
console.log("MEXC Base URL:", process.env.MEXC_BASE_URL);
console.log(
  "SQLite:",
  db.prepare("SELECT sqlite_version() AS version").get().version,
);
console.log("Trading config: VALID");
console.log("Symbols:", tradingConfig.symbols.join(", "));
console.log(
  "Total orders per symbol:",
  1 + tradingConfig.dca.levels,
);
console.log("Database: connected");

const hasApiCredentials =
  Boolean(process.env.MEXC_API_KEY) &&
  Boolean(process.env.MEXC_API_SECRET);

let liveTradingEnabled = false;

if (!hasApiCredentials) {
  console.log(
    "Live trading: DISABLED (MEXC API credentials are not configured)",
  );
} else {
  const accountReadiness = await mexcAccountHealthService.check();

  liveTradingEnabled =
    accountReadiness.status === "OK" &&
    accountReadiness.authenticated === true &&
    accountReadiness.canTrade === true &&
    accountReadiness.tradingReady === true;

  if (!liveTradingEnabled) {
    console.log("Live trading: DISABLED");
    console.log(
      "Live trading reason:",
      accountReadiness.reason ??
        (accountReadiness.status !== "OK"
          ? "MEXC account health check failed"
          : "MEXC account is not trading ready"),
    );
  } else {
    console.log("Live trading: ENABLED");
  }
}

if (liveTradingEnabled) {
  try {
    const recovery =
      await exitOrderRecoveryService.recover();

    const terminalRecovery =
      await terminalOrderRecoveryService.recover();

    const orderIntentRecovery =
      await orderIntentRecoveryService.recover();

    console.log(
      "[TerminalRecovery]",
      JSON.stringify(terminalRecovery, null, 2),
    );

    console.log(
      "[OrderIntentRecovery]",
      JSON.stringify(orderIntentRecovery, null, 2),
    );

    console.log(
      "[ExitRecovery]",
      JSON.stringify(recovery, null, 2),
    );

    const reconciliation =
      await exchangeReconciliationService.reconcile();

    console.log(
      "[Reconciliation]",
      JSON.stringify(reconciliation, null, 2),
    );

    const orphanRecovery =
      await exchangeOrphanOrderRecoveryService.recover();

    console.log(
      "[OrphanRecovery]",
      JSON.stringify(orphanRecovery, null, 2),
    );

    const startup =
      await allSymbolsStartupService.startInitialCycles();

    console.log(
      "[Startup]",
      JSON.stringify(startup, null, 2),
    );

    pollingRunner.start();
    exchangeReconciliationRunner.start();
    terminalOrderRecoveryRunner.start();
    orderIntentRecoveryRunner.start();
    exchangeOrphanOrderRecoveryRunner.start();

    console.log("[OrderPolling] Started: 5000ms");
    console.log("[Reconciliation] Runner started: 60000ms");
    console.log("[OrderIntentRecovery] Runner started: 60000ms");
    console.log("[OrphanRecovery] Runner started: 60000ms");
  } catch (error) {
    console.error("[Startup] Failed:", error.message);
  }
}

async function shutdown(signal) {
  console.log(`[Shutdown] ${signal}`);

  pollingRunner.stop();
  exchangeReconciliationRunner.stop();
  terminalOrderRecoveryRunner.stop();
  orderIntentRecoveryRunner.stop();
  exchangeOrphanOrderRecoveryRunner.stop();

  try {
    await tradingConfigApi.stop();
  } catch (error) {
    console.error(
      "[ConfigAPI] Shutdown failed:",
      error.message,
    );
  }

  if (db.open) {
    db.close();
  }

  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
