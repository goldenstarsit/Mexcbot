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

const symbol = "M79USDT";

function cleanup() {
  db.prepare(`
    DELETE FROM fills
    WHERE exchange_order_id IN (
      SELECT id FROM exchange_orders WHERE symbol = ?
    )
  `).run(symbol);

  db.prepare(`
    DELETE FROM exchange_orders
    WHERE symbol = ?
  `).run(symbol);

  db.prepare(`
    DELETE FROM trading_cycles
    WHERE symbol = ?
  `).run(symbol);
}

function createService() {
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
    triggerInitialOrder: async () => ({
      triggered: true,
    }),
    tradingConfigService: {
      createCycleSnapshot: () => ({
        config: {
          symbols: [symbol],
          takeProfit: 1,
          stopLoss: 50,
        },
      }),
    },
  });
}

try {
  cleanup();

  const cycle = tradingCycleRepository.create({
    symbol,
    status: "EXIT_PENDING",
    cycleNumber: 1,
    configSnapshot: {
      config: {
        symbols: [symbol],
        takeProfit: 1,
        stopLoss: 50,
      },
    },
  });

  const exchangeOrder = exchangeOrderRepository.create({
    tradingCycleId: cycle.id,
    symbol,
    exchangeOrderId: "M79-SELL-1",
    clientOrderId: "mxc-c79-tp",
    side: "SELL",
    orderType: "LIMIT_MAKER",
    price: 101,
    quantity: 0.03,
    status: "PARTIALLY_FILLED",
  });

  const fill1 = fillRepository.create({
    exchangeOrderId: exchangeOrder.id,
    exchangeTradeId: "M79-T1",
    symbol,
    side: "SELL",
    price: 101,
    quantity: 0.01,
    filledAt: new Date().toISOString(),
  });

  const service = createService();

  const partial = await service.processExitFill({
    cycleId: cycle.id,
    symbol,
    fill: fill1,
    exchangeOrder,
  });

  assert.equal(partial.exitComplete, false);
  assert.equal(partial.status, "EXIT_PENDING");
  assert.equal(partial.totalSoldQuantity, 0.01);
  assert.ok(Math.abs(partial.remainingSellQuantity - 0.02) < 1e-12);
  assert.equal(tradingCycleRepository.findById(cycle.id).status, "EXIT_PENDING");

  const fill2 = fillRepository.create({
    exchangeOrderId: exchangeOrder.id,
    exchangeTradeId: "M79-T2",
    symbol,
    side: "SELL",
    price: 101,
    quantity: 0.02,
    filledAt: new Date().toISOString(),
  });

  exchangeOrderRepository.updateStatus(
    exchangeOrder.id,
    "FILLED",
  );

  const completed = await service.completeExitAndStartNewCycle({
    cycleId: cycle.id,
    symbol,
    fill: fill2,
    exchangeOrder: exchangeOrderRepository.findById(exchangeOrder.id),
  });

  assert.equal(completed.newCycleStarted, true);
  assert.equal(completed.exit.exitComplete, true);
  assert.ok(Math.abs(completed.exit.totalSoldQuantity - 0.03) < 1e-12);
  assert.equal(completed.exit.remainingSellQuantity, 0);

  const closedCycle = tradingCycleRepository.findById(cycle.id);
  assert.equal(closedCycle.status, "CLOSED");

  const newCycle = tradingCycleRepository.findById(
    completed.cycle.cycleId,
  );

  assert.equal(newCycle.symbol, symbol);
  assert.equal(newCycle.cycle_number, 2);
  assert.equal(newCycle.status, "OPEN");

  console.log("M79 PARTIAL-SELL RECOVERY: PASS");
  console.log({
    partialFillProtected: true,
    partialSoldQuantity: partial.totalSoldQuantity,
    partialRemainingQuantity: partial.remainingSellQuantity,
    fullExitDetected: completed.exit.exitComplete,
    totalSoldQuantity: completed.exit.totalSoldQuantity,
    cycleClosedOnlyAfterFullExit: closedCycle.status === "CLOSED",
    nextCycleStarted: completed.newCycleStarted,
    nextCycleNumber: newCycle.cycle_number,
  });
} finally {
  cleanup();
}
