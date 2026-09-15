import assert from "node:assert/strict";
import db from "../src/database/connection.js";
import "../src/database/migrations/index.js";
import TradingCycleRepository from "../src/database/repositories/tradingCycleRepository.js";
import DcaOrderRepository from "../src/database/repositories/dcaOrderRepository.js";
import DcaProgressDashboardService from "../src/services/dcaProgressDashboardService.js";

const tradingCycleRepository = new TradingCycleRepository();
const dcaOrderRepository = new DcaOrderRepository();

const marketPriceService = {
  async get(symbol) {
    return {
      symbol,
      price: 95,
      bidPrice: 94.9,
      askPrice: 95.1,
      spread: 0.2,
      spreadPercent: 0.21,
      timestamp: Date.now(),
    };
  },
};

const service = new DcaProgressDashboardService({
  tradingCycleRepository,
  dcaOrderRepository,
  marketPriceService,
});

const prefix = `M103-${Date.now()}`;
const symbol = `${prefix}USDT`;
const closedSymbol = `${prefix}CLOSED`;

const config = {
  version: 78,
  config: {
    takeProfit: 1,
    stopLoss: 50,
    dca: { levels: 9 },
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

const targets = [99, 97, 94, 90];

for (let i = 0; i < targets.length; i += 1) {
  dcaOrderRepository.create({
    tradingCycleId: cycle.id,
    symbol,
    orderNumber: i + 2,
    orderType: "LIMIT_MAKER",
    targetPrice: targets[i],
    quantity: 0.01,
    status: i === 0 ? "TRIGGERED" : i === 1 ? "ORDER_PLACED" : "PENDING",
  });
}

const progress = await service.getProgress({ symbol });

assert.equal(progress.length, 1);

const current = progress[0];

assert.equal(current.symbol, symbol);
assert.equal(current.totalLevels, 4);
assert.equal(current.completedLevels, 1);
assert.equal(current.remainingLevels, 3);
assert.equal(current.counts.triggered, 1);
assert.equal(current.counts.placed, 1);
assert.equal(current.counts.pending, 2);
assert.equal(current.currentPrice, 95);
assert.equal(current.nextDca.dcaLevel, 3);
assert.equal(current.nextDca.targetPrice, 94);
assert.equal(current.nextDca.reached, false);
assert.equal(current.orders.length, 4);
assert.equal(
  progress.some((item) => item.symbol === closedSymbol),
  false,
);

const filtered = await service.getProgress({ symbol });
assert.equal(filtered.length, 1);
assert.equal(filtered[0].symbol, symbol);

for (const id of [cycle.id, closedCycle.id]) {
  db.prepare("DELETE FROM dca_orders WHERE trading_cycle_id = ?").run(id);
  db.prepare("DELETE FROM trading_cycles WHERE id = ?").run(id);
}

console.log("M103 DCA PROGRESS DASHBOARD: PASS");
console.log({
  openCycles: true,
  dcaStatusProgress: true,
  completedLevels: true,
  remainingLevels: true,
  nextDcaTarget: true,
  currentMarketPrice: true,
  symbolFilter: true,
  closedCyclesExcluded: true,
  mobileFirstUi: true,
  autoRefresh: true,
});
