import "dotenv/config";

import tradingConfig from "./config/trading.config.js";
import { validateTradingConfig } from "./config/validateTradingConfig.js";

import db from "./database/connection.js";
import "./database/migrations/index.js";

import MexcClient from "./exchange/mexcClient.js";
import MarketPriceService from "./exchange/marketPriceService.js";
import MexcSymbolRules from "./exchange/mexcSymbolRules.js";

import TradingCycleRepository from "./database/repositories/tradingCycleRepository.js";
import DcaOrderRepository from "./database/repositories/dcaOrderRepository.js";
import ExchangeOrderRepository from "./database/repositories/exchangeOrderRepository.js";
import FillRepository from "./database/repositories/fillRepository.js";

import DcaCalculator from "./services/dcaCalculator.js";
import QuantityCalculator from "./services/quantityCalculator.js";
import MakerOrderEngine from "./services/makerOrderEngine.js";
import DcaOrderManager from "./services/dcaOrderManager.js";
import PositionCalculator from "./services/positionCalculator.js";
import PositionProtectionService from "./services/positionProtectionService.js";
import TradingCycleExecutionService from "./services/tradingCycleExecutionService.js";
import CycleLifecycleService from "./services/cycleLifecycleService.js";
import AllSymbolsStartupService from "./services/allSymbolsStartupService.js";
import ExchangeOrderFillMonitorService from "./services/exchangeOrderFillMonitorService.js";
import ExchangeOrderPollingRunner from "./services/exchangeOrderPollingRunner.js";

validateTradingConfig(tradingConfig);

const mexcClient = new MexcClient();
const marketPriceService = new MarketPriceService(mexcClient);
const symbolRulesService = new MexcSymbolRules(mexcClient);

const tradingCycleRepository = new TradingCycleRepository();
const dcaOrderRepository = new DcaOrderRepository();
const exchangeOrderRepository = new ExchangeOrderRepository();
const fillRepository = new FillRepository();

const dcaCalculator = new DcaCalculator(tradingConfig);
const quantityCalculator = new QuantityCalculator(1);

const makerOrderEngine = new MakerOrderEngine(
  mexcClient,
  tradingConfig,
);

const dcaOrderManager = new DcaOrderManager({
  dcaOrderRepository,
  dcaCalculator,
  quantityCalculator,
  makerOrderEngine,
  marketPriceService,
  symbolRulesService,
  exchangeOrderRepository,
});

const positionCalculator = new PositionCalculator();

const positionProtectionService = new PositionProtectionService({
  positionCalculator,
  dcaCalculator,
  quantityCalculator,
  symbolRulesService,
  tradingConfig,
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
    positionProtectionService,
  });

const cycleLifecycleService = new CycleLifecycleService({
  tradingCycleRepository,
  exchangeOrderRepository,
  fillRepository,
  positionCalculator,
  marketPriceService,
  makerOrderEngine,
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
  });

const pollingRunner = new ExchangeOrderPollingRunner({
  exchangeOrderRepository,
  exchangeOrderFillMonitorService,
  intervalMs: 2000,
});

const allSymbolsStartupService =
  new AllSymbolsStartupService({
    tradingConfig,
    marketPriceService,
    tradingCycleRepository,
    tradingCycleExecutionService,
  });

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

if (!hasApiCredentials) {
  console.log(
    "Live trading: DISABLED (MEXC API credentials are not configured)",
  );
} else {
  console.log("Live trading: ENABLED");

  try {
    const startup =
      await allSymbolsStartupService.startInitialCycles();

    console.log(
      "[Startup]",
      JSON.stringify(startup, null, 2),
    );

    pollingRunner.start();

    console.log("[OrderPolling] Started: 2000ms");
  } catch (error) {
    console.error("[Startup] Failed:", error.message);
  }
}

function shutdown(signal) {
  console.log(`[Shutdown] ${signal}`);
  pollingRunner.stop();

  if (db.open) {
    db.close();
  }

  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
