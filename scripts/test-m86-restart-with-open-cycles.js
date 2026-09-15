import assert from "node:assert/strict";
import db from "../src/database/connection.js";
import TradingCycleRepository from "../src/database/repositories/tradingCycleRepository.js";
import AllSymbolsStartupService from "../src/services/allSymbolsStartupService.js";

const symbols = ["M86BTCUSDT", "M86ETHUSDT", "M86SOLUSDT"];

const tradingCycleRepository = new TradingCycleRepository();

const tradingConfigService = {
  getCurrent() {
    return {
      config: {
        symbols,
        takeProfit: 1,
        stopLoss: 50,
      },
    };
  },

  createCycleSnapshot() {
    return {
      version: 2,
      config: {
        symbols,
        takeProfit: 1,
        stopLoss: 50,
        dca: {
          levels: 9,
        },
      },
    };
  },
};

const marketPriceService = {
  async get(symbol) {
    return {
      symbol,
      price: 100,
      bidPrice: 99.99,
      askPrice: 100.01,
    };
  },
};

const initialOrders = [];

const tradingCycleExecutionService = {
  async triggerInitialOrder({ cycleId, symbol }) {
    initialOrders.push({ cycleId, symbol });
    return {
      cycleId,
      symbol,
      status: "TRIGGERED",
    };
  },
};

function cleanup() {
  for (const symbol of symbols) {
    db.prepare(`
      DELETE FROM trading_cycles
      WHERE symbol = ?
    `).run(symbol);
  }
}

try {
  cleanup();

  // Simulate cycles that already existed before the bot restart.
  const btcCycle = tradingCycleRepository.create({
    symbol: symbols[0],
    status: "OPEN",
    configSnapshot: {
      version: 1,
      config: {
        symbols,
        takeProfit: 2,
        stopLoss: 40,
      },
    },
  });

  const ethCycle = tradingCycleRepository.create({
    symbol: symbols[1],
    status: "OPEN",
    configSnapshot: {
      version: 1,
      config: {
        symbols,
        takeProfit: 3,
        stopLoss: 30,
      },
    },
  });

  // SOL intentionally has no OPEN cycle and must start a new cycle.
  const startupService = new AllSymbolsStartupService({
    tradingConfig: tradingConfigService.getCurrent().config,
    tradingConfigService,
    marketPriceService,
    tradingCycleRepository,
    tradingCycleExecutionService,
  });

  const firstStartup = await startupService.startInitialCycles();

  assert.equal(firstStartup.ready, true);
  assert.equal(firstStartup.results.length, 3);

  const btcResult = firstStartup.results.find(
    (result) => result.symbol === symbols[0],
  );
  const ethResult = firstStartup.results.find(
    (result) => result.symbol === symbols[1],
  );
  const solResult = firstStartup.results.find(
    (result) => result.symbol === symbols[2],
  );

  // Existing OPEN cycles must be reused.
  assert.equal(btcResult.status, "ALREADY_OPEN");
  assert.equal(btcResult.cycleId, btcCycle.id);
  assert.equal(btcResult.cycleNumber, btcCycle.cycle_number);

  assert.equal(ethResult.status, "ALREADY_OPEN");
  assert.equal(ethResult.cycleId, ethCycle.id);
  assert.equal(ethResult.cycleNumber, ethCycle.cycle_number);

  // Only the symbol without an OPEN cycle starts a new cycle.
  assert.equal(solResult.status, "INITIAL_ORDER_TRIGGERED");
  assert.equal(initialOrders.length, 1);
  assert.equal(initialOrders[0].symbol, symbols[2]);

  const recoveredBtc = tradingCycleRepository.findOpenBySymbol(symbols[0]);
  const recoveredEth = tradingCycleRepository.findOpenBySymbol(symbols[1]);
  const newSol = tradingCycleRepository.findOpenBySymbol(symbols[2]);

  assert.equal(recoveredBtc.id, btcCycle.id);
  assert.equal(recoveredEth.id, ethCycle.id);

  // Existing cycle snapshots must remain unchanged.
  const btcSnapshot = JSON.parse(recoveredBtc.config_snapshot_json);
  const ethSnapshot = JSON.parse(recoveredEth.config_snapshot_json);

  assert.equal(btcSnapshot.config.takeProfit, 2);
  assert.equal(btcSnapshot.config.stopLoss, 40);
  assert.equal(ethSnapshot.config.takeProfit, 3);
  assert.equal(ethSnapshot.config.stopLoss, 30);

  // New cycle receives the current runtime configuration.
  const solSnapshot = JSON.parse(newSol.config_snapshot_json);

  assert.equal(solSnapshot.version, 2);
  assert.equal(solSnapshot.config.takeProfit, 1);
  assert.equal(solSnapshot.config.stopLoss, 50);

  // Simulate a second restart using a fresh startup service.
  const secondStartupService = new AllSymbolsStartupService({
    tradingConfig: tradingConfigService.getCurrent().config,
    tradingConfigService,
    marketPriceService,
    tradingCycleRepository,
    tradingCycleExecutionService,
  });

  const secondStartup = await secondStartupService.startInitialCycles();

  assert.equal(secondStartup.ready, true);

  for (const result of secondStartup.results) {
    assert.equal(result.status, "ALREADY_OPEN");
  }

  // No duplicate initial BUY must be triggered after restart.
  assert.equal(initialOrders.length, 1);

  const allOpenCycles = symbols.map((symbol) =>
    tradingCycleRepository.findOpenBySymbol(symbol),
  );

  assert.equal(new Set(allOpenCycles.map((cycle) => cycle.id)).size, 3);

  console.log("M86 RESTART WITH OPEN CYCLES: PASS");
  console.log({
    existingOpenCyclesRecovered: true,
    existingCycleNumbersPreserved: true,
    existingConfigSnapshotsPreserved: true,
    missingSymbolCycleStarted: true,
    newCycleUsedCurrentConfig: true,
    duplicateCyclesPrevented: true,
    duplicateInitialOrdersPrevented: true,
    openCycles: allOpenCycles.map((cycle) => ({
      symbol: cycle.symbol,
      cycleNumber: cycle.cycle_number,
      status: cycle.status,
    })),
  });
} finally {
  cleanup();
}
