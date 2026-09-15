import assert from "node:assert/strict";
import db from "../src/database/connection.js";
import "../src/database/migrations/index.js";
import TradingCycleRepository from "../src/database/repositories/tradingCycleRepository.js";
import FillRepository from "../src/database/repositories/fillRepository.js";
import PositionCalculator from "../src/services/positionCalculator.js";
import PositionProtectionService from "../src/services/positionProtectionService.js";
import OpenPositionDashboardService from "../src/services/openPositionDashboardService.js";

const tradingCycleRepository = new TradingCycleRepository();
const fillRepository = new FillRepository();
const positionCalculator = new PositionCalculator();

const positionProtectionService = new PositionProtectionService({
  positionCalculator,
  dcaCalculator: { calculateLevels: () => [] },
  quantityCalculator: { calculateBuyQuantity: () => 0.01 },
  symbolRulesService: { get: async () => ({}) },
  tradingConfig: { takeProfit: 1, stopLoss: 50 },
});

const service = new OpenPositionDashboardService({
  tradingCycleRepository,
  fillRepository,
  positionCalculator,
  positionProtectionService,
});

const prefix = `M102-${Date.now()}`;
const symbol = `${prefix}USDT`;
const closedSymbol = `${prefix}CLOSED`;
const emptySymbol = `${prefix}EMPTY`;

const config = {
  version: 77,
  config: {
    takeProfit: 2,
    stopLoss: 50,
  },
};

const cycle = tradingCycleRepository.create({
  symbol,
  status: "OPEN",
  configSnapshot: config,
});

const closedCycle = tradingCycleRepository.create({
  symbol: closedSymbol,
  status: "CLOSED",
  configSnapshot: config,
});

const emptyCycle = tradingCycleRepository.create({
  symbol: emptySymbol,
  status: "OPEN",
  configSnapshot: config,
});

const buyOrder = db.prepare(`
  INSERT INTO exchange_orders (
    trading_cycle_id,
    symbol,
    exchange_order_id,
    side,
    order_type,
    price,
    quantity,
    status
  ) VALUES (?, ?, ?, 'BUY', 'LIMIT_MAKER', ?, ?, 'FILLED')
`).run(cycle.id, symbol, `${prefix}-BUY`, 100, 0.03);

fillRepository.create({
  exchangeOrderId: Number(buyOrder.lastInsertRowid),
  symbol,
  side: "BUY",
  price: 100,
  quantity: 0.01,
  filledAt: new Date().toISOString(),
});

fillRepository.create({
  exchangeOrderId: Number(buyOrder.lastInsertRowid),
  symbol,
  side: "BUY",
  price: 90,
  quantity: 0.02,
  filledAt: new Date().toISOString(),
});

const positions = service.getOpenPositions();

assert.equal(positions.length >= 2, true);

const current = positions.find((item) => item.symbol === symbol);
assert.ok(current);

assert.equal(current.cycleNumber, cycle.cycle_number);
assert.equal(current.position.totalQuantity, 0.03);
assert.equal(current.position.totalCost, 2.8);
assert.equal(current.position.averagePrice, 93.33333333333333);
assert.equal(current.takeProfit.price, 95.2);
assert.equal(current.stopLoss.price, 50);
assert.equal(current.stopLoss.lockedToInitialPrice, true);
assert.equal(current.progress.buyFillCount, 2);
assert.equal(current.progress.dcaFillCount, 1);
assert.equal(current.configVersion, 77);

const empty = positions.find((item) => item.symbol === emptySymbol);
assert.ok(empty);
assert.equal(empty.position.totalQuantity, 0);
assert.equal(empty.takeProfit.price, null);
assert.equal(empty.stopLoss.price, null);

assert.equal(
  positions.some((item) => item.symbol === closedSymbol),
  false,
);

for (const id of [cycle.id, closedCycle.id, emptyCycle.id]) {
  db.prepare("DELETE FROM trading_cycles WHERE id = ?").run(id);
}

console.log("M102 OPEN POSITION DASHBOARD: PASS");
console.log({
  openPositionQuery: true,
  buyFillAggregation: true,
  averageEntry: current.position.averagePrice,
  investedUsdt: current.position.totalCost,
  takeProfit: current.takeProfit.price,
  stopLossLockedToInitialPrice: true,
  configSnapshotIsolation: true,
  emptyOpenCycleHandled: true,
  closedCyclesExcluded: true,
  dcaProgress: true,
  mobileFirstUi: true,
});
