import assert from "node:assert/strict";
import db from "../src/database/connection.js";
import TradingCycleRepository from "../src/database/repositories/tradingCycleRepository.js";
import DcaOrderRepository from "../src/database/repositories/dcaOrderRepository.js";
import FillRepository from "../src/database/repositories/fillRepository.js";
import ExchangeOrderRepository from "../src/database/repositories/exchangeOrderRepository.js";
import PositionCalculator from "../src/services/positionCalculator.js";
import PositionProtectionService from "../src/services/positionProtectionService.js";
import TpSlStatusDashboardService from "../src/services/tpSlStatusDashboardService.js";

const tradingCycleRepository = new TradingCycleRepository();
const dcaOrderRepository = new DcaOrderRepository();
const fillRepository = new FillRepository();
const exchangeOrderRepository = new ExchangeOrderRepository();

const positionCalculator = new PositionCalculator();
const positionProtectionService = new PositionProtectionService({
  positionCalculator,
  dcaCalculator: { calculateLevels: () => [] },
  quantityCalculator: {},
  symbolRulesService: {},
  tradingConfig: { takeProfit: 1, stopLoss: 50 },
});

const service = new TpSlStatusDashboardService({
  tradingCycleRepository,
  fillRepository,
  exchangeOrderRepository,
  positionCalculator,
  positionProtectionService,
});

const symbol = `M104${Date.now()}USDT`;

const cycle = tradingCycleRepository.create({
  symbol,
  cycleNumber: tradingCycleRepository.getNextCycleNumber(symbol),
  status: "OPEN",
  configSnapshot: {
    version: 104,
    config: {
      takeProfit: 1,
      stopLoss: 50,
    },
  },
});

const initial = exchangeOrderRepository.create({
  tradingCycleId: cycle.id,
  symbol,
  exchangeOrderId: `m104-buy-${Date.now()}`,
  side: "BUY",
  orderType: "LIMIT_MAKER",
  price: 100,
  quantity: 0.02,
  status: "FILLED",
});

fillRepository.create({
  exchangeOrderId: initial.id,
  tradingCycleId: cycle.id,
  symbol,
  side: "BUY",
  price: 100,
  quantity: 0.02,
  filledAt: new Date().toISOString(),
});

const tp = exchangeOrderRepository.create({
  tradingCycleId: cycle.id,
  symbol,
  exchangeOrderId: `m104-tp-${Date.now()}`,
  clientOrderId: `mxc-c${cycle.id}-tp`,
  side: "SELL",
  orderType: "LIMIT_MAKER",
  price: 101,
  quantity: 0.02,
  status: "ORDER_PLACED",
});

const sl = exchangeOrderRepository.create({
  tradingCycleId: cycle.id,
  symbol,
  exchangeOrderId: `m104-sl-${Date.now()}`,
  clientOrderId: `mxc-c${cycle.id}-sl`,
  side: "SELL",
  orderType: "LIMIT_MAKER",
  price: 50,
  quantity: 0.02,
  status: "CANCELED",
});

const progress = service.getStatus({ symbol });

assert.equal(progress.length, 1);
assert.equal(progress[0].symbol, symbol);
assert.equal(progress[0].position.averagePrice, 100);
assert.equal(progress[0].takeProfit.calculatedPrice, 101);
assert.equal(progress[0].stopLoss.calculatedPrice, 50);
assert.equal(progress[0].takeProfit.order.id, tp.id);
assert.equal(progress[0].takeProfit.order.status, "ORDER_PLACED");
assert.equal(progress[0].stopLoss.order.id, sl.id);
assert.equal(progress[0].stopLoss.order.status, "CANCELED");
assert.equal(progress[0].stopLoss.lockedToInitialPrice, true);

const filtered = service.getStatus({ symbol: "DOESNOTEXISTUSDT" });
assert.equal(filtered.length, 0);

dcaOrderRepository.findByCycleId(cycle.id).forEach((row) => {
  db.prepare("DELETE FROM dca_orders WHERE id = ?").run(row.id);
});
db.prepare("DELETE FROM fills WHERE exchange_order_id IN (SELECT id FROM exchange_orders WHERE trading_cycle_id = ?)").run(cycle.id);
db.prepare("DELETE FROM exchange_orders WHERE trading_cycle_id = ?").run(cycle.id);
db.prepare("DELETE FROM trading_cycles WHERE id = ?").run(cycle.id);

console.log("M104 TP/SL STATUS DASHBOARD: PASS");
console.log({
  openCycle: true,
  averagePrice: true,
  takeProfitCalculation: true,
  stopLossLocked: true,
  tpOrderStatus: true,
  slOrderStatus: true,
  symbolFilter: true,
});
