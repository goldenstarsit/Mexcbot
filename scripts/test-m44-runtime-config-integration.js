import tradingConfig from "../src/config/trading.config.js";
import db from "../src/database/connection.js";
import RuntimeTradingConfigRepository from "../src/database/repositories/runtimeTradingConfigRepository.js";
import TradingConfigService from "../src/services/tradingConfigService.js";
import ExchangeOrphanOrderRecoveryService from "../src/services/exchangeOrphanOrderRecoveryService.js";
import ExchangeOrderFillMonitorService from "../src/services/exchangeOrderFillMonitorService.js";
import TerminalOrderRecoveryService from "../src/services/terminalOrderRecoveryService.js";

const repository = new RuntimeTradingConfigRepository(db);

const tradingConfigService = new TradingConfigService({
  runtimeTradingConfigRepository: repository,
  defaultConfig: tradingConfig,
});

const original = tradingConfigService.getCurrent();

const oldSnapshot = {
  version: original.version,
  config: structuredClone(original.config),
};

try {
  const updatedConfig = structuredClone(original.config);
  updatedConfig.symbols = ["BTCUSDT", "ETHUSDT"];
  updatedConfig.takeProfit =
    Number(original.config.takeProfit) === 2 ? 3 : 2;
  updatedConfig.stopLoss =
    Number(original.config.stopLoss) === 30 ? 40 : 30;
  updatedConfig.fillProcessing.maxAttempts = 7;
  updatedConfig.terminalRecovery.maxAttempts = 8;

  tradingConfigService.update(updatedConfig);

  const current = tradingConfigService.getCurrent();

  // Verify cycle snapshot isolation.
  const newSnapshot = tradingConfigService.createCycleSnapshot();

  if (oldSnapshot.config.takeProfit === newSnapshot.config.takeProfit) {
    throw new Error("Old/new cycle TP snapshot was not isolated");
  }

  if (oldSnapshot.config.stopLoss === newSnapshot.config.stopLoss) {
    throw new Error("Old/new cycle SL snapshot was not isolated");
  }

  // Verify orphan recovery reads runtime symbols.
  const scannedSymbols = [];

  const orphanRecovery =
    new ExchangeOrphanOrderRecoveryService({
      mexcClient: {
        async getOpenOrders(symbol) {
          scannedSymbols.push(symbol);
          return [];
        },
      },
      tradingConfig: tradingConfig,
      tradingConfigService,
      exchangeOrderRepository: {
        findByExchangeOrderId() {
          return null;
        },
      },
      tradingCycleRepository: {
        findById() {
          return null;
        },
      },
      dcaOrderRepository: {
        findById() {
          return null;
        },
      },
    });

  const orphanResult = await orphanRecovery.recover();

  if (
    JSON.stringify(scannedSymbols) !==
    JSON.stringify(updatedConfig.symbols)
  ) {
    throw new Error(
      `Orphan recovery scanned wrong symbols: ${JSON.stringify(scannedSymbols)}`,
    );
  }

  if (orphanResult.checkedSymbols !== 2) {
    throw new Error(
      `Expected 2 runtime symbols, got ${orphanResult.checkedSymbols}`,
    );
  }

  // Verify runtime fill-processing limit.
  const fillMonitor =
    new ExchangeOrderFillMonitorService({
      mexcClient: {},
      exchangeOrderRepository: {},
      fillRepository: {},
      tradingCycleExecutionService: {},
      cycleLifecycleService: {},
      tradingConfigService,
    });

  if (fillMonitor.getMaxFillProcessingAttempts() !== 7) {
    throw new Error("Runtime fillProcessing.maxAttempts was not applied");
  }

  // Verify runtime terminal-recovery limit.
  const terminalRecovery =
    new TerminalOrderRecoveryService({
      tradingCycleRepository: {},
      dcaOrderRepository: {},
      exchangeOrderRepository: {},
      tradingCycleExecutionService: {},
      cycleLifecycleService: {},
      duplicateProtectionService: {},
      dcaOrderManager: {},
      fillRepository: {},
      tradingConfigService,
    });

  if (terminalRecovery.getMaxAttempts() !== 8) {
    throw new Error("Runtime terminalRecovery.maxAttempts was not applied");
  }

  console.log("M44 RUNTIME CONFIG INTEGRATION: PASS");
  console.log({
    runtimeVersion: current.version,
    runtimeSymbols: current.config.symbols,
    oldCycleTakeProfit: oldSnapshot.config.takeProfit,
    newCycleTakeProfit: newSnapshot.config.takeProfit,
    oldCycleStopLoss: oldSnapshot.config.stopLoss,
    newCycleStopLoss: newSnapshot.config.stopLoss,
    orphanScannedSymbols: scannedSymbols,
    fillProcessingMaxAttempts:
      fillMonitor.getMaxFillProcessingAttempts(),
    terminalRecoveryMaxAttempts:
      terminalRecovery.getMaxAttempts(),
  });
} finally {
  tradingConfigService.update(original.config);
  db.close();
}
