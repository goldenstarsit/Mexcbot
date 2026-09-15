import assert from "node:assert/strict";
import db from "../src/database/connection.js";
import "../src/database/migrations/index.js";
import TradingCycleRepository from "../src/database/repositories/tradingCycleRepository.js";
import ExchangeOrderRepository from "../src/database/repositories/exchangeOrderRepository.js";
import FillRepository from "../src/database/repositories/fillRepository.js";
import CycleLifecycleService from "../src/services/cycleLifecycleService.js";

const tradingCycleRepository = new TradingCycleRepository();
const exchangeOrderRepository = new ExchangeOrderRepository();
const fillRepository = new FillRepository();

const symbol = "M81USDT";
const otherSymbol = "M81OTHERUSDT";
const triggered = [];

function cleanup() {
  db.prepare(`
    DELETE FROM fills
    WHERE exchange_order_id IN (
      SELECT id FROM exchange_orders WHERE symbol IN (?, ?)
    )
  `).run(symbol, otherSymbol);

  db.prepare(`
    DELETE FROM exchange_orders WHERE symbol IN (?, ?)
  `).run(symbol, otherSymbol);

  db.prepare(`
    DELETE FROM trading_cycles WHERE symbol IN (?, ?)
  `).run(symbol, otherSymbol);
}

function service(configVersion = 2) {
  return new CycleLifecycleService({
    tradingCycleRepository,
    exchangeOrderRepository,
    fillRepository,
    positionCalculator: {},
    marketPriceService: {},
    makerOrderEngine: {},
    quantityCalculator: {},
    symbolRulesService: {},
    duplicateProtectionService: {},
    triggerInitialOrder: async ({ cycleId, symbol }) => {
      triggered.push({ cycleId, symbol });
      return { triggered: true, cycleId, symbol };
    },
    tradingConfigService: {
      createCycleSnapshot: () => ({
        config: {
          version: configVersion,
          symbols: [symbol, otherSymbol],
          takeProfit: 2,
          stopLoss: 50,
        },
      }),
    },
  });
}

try {
  cleanup();

  const cycle1 = tradingCycleRepository.create({
    symbol,
    status: "CLOSED",
    configSnapshot: {
      config: {
        version: 1,
        symbols: [symbol, otherSymbol],
        takeProfit: 1,
        stopLoss: 50,
      },
    },
  });

  const otherCycle = tradingCycleRepository.create({
    symbol: otherSymbol,
    status: "OPEN",
    configSnapshot: {
      config: {
        version: 1,
        symbols: [symbol, otherSymbol],
        takeProfit: 1,
        stopLoss: 50,
      },
    },
  });

  const s = service(2);

  const transition = await s.startNewCycle({
    previousCycleId: cycle1.id,
    symbol,
  });

  const newCycle = tradingCycleRepository.findById(transition.cycleId);
  const snapshot = JSON.parse(newCycle.config_snapshot_json);

  assert.equal(cycle1.status, "CLOSED");
  assert.equal(newCycle.status, "OPEN");
  assert.equal(newCycle.cycle_number, 2);
  assert.equal(snapshot.config.version, 2);
  assert.equal(snapshot.config.takeProfit, 2);

  const initialOrder = await s.triggerInitialOrder({
    cycleId: newCycle.id,
    symbol,
  });

  assert.equal(initialOrder.triggered, true);
  assert.equal(triggered.length, 1);

  await assert.rejects(
    () => s.startNewCycle({
      previousCycleId: cycle1.id,
      symbol,
    }),
    /previous cycle is still open/,
  );

  const cycles = tradingCycleRepository.listBySymbol(symbol);
  const other = tradingCycleRepository.findById(otherCycle.id);

  assert.equal(cycles.length, 2);
  assert.deepEqual(
    cycles.map((c) => c.cycle_number).sort((a, b) => a - b),
    [1, 2],
  );
  assert.equal(other.cycle_number, 1);
  assert.equal(other.status, "OPEN");

  console.log("M81 CLOSED CYCLE → NEXT CYCLE INTEGRITY: PASS");
  console.log({
    previousCycle: cycle1.cycle_number,
    nextCycle: newCycle.cycle_number,
    nextCycleStatus: newCycle.status,
    newConfigSnapshot: snapshot.config.version,
    initialOrderTriggered: triggered.length === 1,
    duplicateNextCycleBlocked: cycles.length === 2,
    otherSymbolUnaffected: other.cycle_number === 1,
  });
} finally {
  cleanup();
}
