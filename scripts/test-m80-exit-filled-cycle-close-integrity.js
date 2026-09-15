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

const symbol = "M80USDT";
const otherSymbol = "M80OTHERUSDT";

function cleanup() {
  db.prepare(`
    DELETE FROM fills
    WHERE exchange_order_id IN (
      SELECT id
      FROM exchange_orders
      WHERE symbol IN (?, ?)
    )
  `).run(symbol, otherSymbol);

  db.prepare(`
    DELETE FROM exchange_orders
    WHERE symbol IN (?, ?)
  `).run(symbol, otherSymbol);

  db.prepare(`
    DELETE FROM trading_cycles
    WHERE symbol IN (?, ?)
  `).run(symbol, otherSymbol);
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
    triggerInitialOrder: async ({ cycleId, symbol: triggerSymbol }) => ({
      triggered: true,
      cycleId,
      symbol: triggerSymbol,
    }),
    tradingConfigService: {
      createCycleSnapshot: () => ({
        config: {
          symbols: [symbol, otherSymbol],
          takeProfit: 1,
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
    status: "EXIT_PENDING",
    cycleNumber: 1,
    configSnapshot: {
      config: {
        symbols: [symbol, otherSymbol],
        takeProfit: 1,
        stopLoss: 50,
      },
    },
  });

  const otherCycle = tradingCycleRepository.create({
    symbol: otherSymbol,
    status: "OPEN",
    cycleNumber: 1,
    configSnapshot: {
      config: {
        symbols: [symbol, otherSymbol],
        takeProfit: 1,
        stopLoss: 50,
      },
    },
  });

  const exchangeOrder = exchangeOrderRepository.create({
    tradingCycleId: cycle1.id,
    symbol,
    exchangeOrderId: "M80-SELL-1",
    clientOrderId: "mxc-m80-tp",
    side: "SELL",
    orderType: "LIMIT_MAKER",
    price: 101,
    quantity: 0.03,
    status: "FILLED",
  });

  const buyOrder = exchangeOrderRepository.create({
    tradingCycleId: cycle1.id,
    symbol,
    exchangeOrderId: "M80-BUY-1",
    clientOrderId: "mxc-m80-buy",
    side: "BUY",
    orderType: "LIMIT_MAKER",
    price: 100,
    quantity: 0.03,
    status: "FILLED",
  });

  fillRepository.create({
    exchangeOrderId: buyOrder.id,
    exchangeTradeId: "M80-B1",
    symbol,
    side: "BUY",
    price: 100,
    quantity: 0.03,
    filledAt: new Date().toISOString(),
  });

  const sellFill = fillRepository.create({
    exchangeOrderId: exchangeOrder.id,
    exchangeTradeId: "M80-S1",
    symbol,
    side: "SELL",
    price: 101,
    quantity: 0.03,
    filledAt: new Date().toISOString(),
  });

  const service = createService();

  const completed = await service.completeExitAndStartNewCycle({
    cycleId: cycle1.id,
    symbol,
    fill: sellFill,
    exchangeOrder,
  });

  assert.equal(completed.newCycleStarted, true);
  assert.equal(completed.exit.exitComplete, true);
  assert.equal(completed.exit.totalSoldQuantity, 0.03);

  const closedCycle = tradingCycleRepository.findById(cycle1.id);

  assert.equal(closedCycle.status, "CLOSED");
  assert.equal(closedCycle.closed_at !== null, true);
  assert.ok(Math.abs(Number(closedCycle.total_asset_sold) - 0.03) < 1e-9);
  assert.ok(Math.abs(Number(closedCycle.total_usdt_returned) - 3.03) < 1e-9);
  assert.ok(Math.abs(Number(closedCycle.total_usdt_invested) - 3) < 1e-9);
  assert.ok(Math.abs(Number(closedCycle.overall_pnl) - 0.03) < 1e-9);

  const newCycle = tradingCycleRepository.findById(
    completed.cycle.cycleId,
  );

  assert.equal(newCycle.symbol, symbol);
  assert.equal(newCycle.cycle_number, 2);
  assert.equal(newCycle.status, "OPEN");

  const otherCycleAfter = tradingCycleRepository.findById(
    otherCycle.id,
  );

  assert.equal(otherCycleAfter.status, "OPEN");
  assert.equal(otherCycleAfter.cycle_number, 1);

  const symbolCycles = tradingCycleRepository.listBySymbol(symbol);

  assert.equal(symbolCycles.length, 2);
  assert.deepEqual(
    symbolCycles.map((cycle) => cycle.cycle_number).sort((a, b) => a - b),
    [1, 2],
  );

  console.log("M80 EXIT FILLED → CYCLE CLOSE INTEGRITY: PASS");
  console.log({
    exitFilled: true,
    cycleClosed: closedCycle.status === "CLOSED",
    closedAtPersisted: closedCycle.closed_at !== null,
    totalAssetSold: Number(closedCycle.total_asset_sold),
    totalUsdtReturned: Number(closedCycle.total_usdt_returned),
    totalUsdtInvested: Number(closedCycle.total_usdt_invested),
    pnl: Number(closedCycle.overall_pnl),
    nextCycleNumber: newCycle.cycle_number,
    otherSymbolUnaffected: otherCycleAfter.cycle_number === 1,
  });
} finally {
  cleanup();
}
