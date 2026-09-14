process.env.MEXCBOT_DB_PATH = "./data/test/m47.db";

import fs from "node:fs";
import path from "node:path";

fs.mkdirSync("./data/test", { recursive: true });

if (fs.existsSync("./data/test/m47.db")) {
  fs.rmSync("./data/test/m47.db");
}

const { default: db } = await import("../src/database/connection.js");
await import("../src/database/migrations/index.js");

const TradingCycleRepository =
  (await import("../src/database/repositories/tradingCycleRepository.js")).default;

const cycleRepository = new TradingCycleRepository();

const cycle = cycleRepository.create({
  symbol: "BTCUSDT",
  status: "OPEN",
  cycleNumber: 1,
  configSnapshot: {
    config: {
      takeProfit: 1,
      stopLoss: 50,
    },
    version: 1,
  },
});

const now = new Date();
const start = new Date(now.getTime() - 3600 * 1000);

db.prepare(`
  UPDATE trading_cycles
  SET created_at = ?
  WHERE id = ?
`).run(start.toISOString(), cycle.id);

const initialOrder = db.prepare(`
  INSERT INTO exchange_orders (
    trading_cycle_id,
    symbol,
    exchange_order_id,
    side,
    order_type,
    price,
    quantity,
    status
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  cycle.id,
  "BTCUSDT",
  "M47-INITIAL",
  "BUY",
  "LIMIT_MAKER",
  100,
  0.01,
  "FILLED",
);

const dcaOrder = db.prepare(`
  INSERT INTO exchange_orders (
    trading_cycle_id,
    symbol,
    exchange_order_id,
    side,
    order_type,
    price,
    quantity,
    status
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  cycle.id,
  "BTCUSDT",
  "M47-DCA-1",
  "BUY",
  "LIMIT_MAKER",
  90,
  0.02,
  "FILLED",
);

const sellOrder = db.prepare(`
  INSERT INTO exchange_orders (
    trading_cycle_id,
    symbol,
    exchange_order_id,
    side,
    order_type,
    price,
    quantity,
    status
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  cycle.id,
  "BTCUSDT",
  "M47-SELL",
  "SELL",
  "LIMIT_MAKER",
  102,
  0.015,
  "FILLED",
);

const insertFill = db.prepare(`
  INSERT INTO fills (
    exchange_order_id,
    exchange_trade_id,
    symbol,
    side,
    price,
    quantity,
    filled_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

insertFill.run(
  initialOrder.lastInsertRowid,
  "M47-TRADE-1",
  "BTCUSDT",
  "BUY",
  100,
  0.01,
  new Date(start.getTime() + 1000).toISOString(),
);

insertFill.run(
  dcaOrder.lastInsertRowid,
  "M47-TRADE-2",
  "BTCUSDT",
  "BUY",
  90,
  0.02,
  new Date(start.getTime() + 1800 * 1000).toISOString(),
);

insertFill.run(
  sellOrder.lastInsertRowid,
  "M47-TRADE-3",
  "BTCUSDT",
  "SELL",
  102,
  0.015,
  new Date(now.getTime()).toISOString(),
);

db.prepare(`
  UPDATE trading_cycles
  SET status = 'CLOSED',
      closed_at = ?
  WHERE id = ?
`).run(now.toISOString(), cycle.id);

const result =
  cycleRepository.updatePerformanceSummary(cycle.id);

const expectedInvested = 2.8;
const expectedReturned = 1.53;
const expectedBought = 0.03;
const expectedSold = 0.015;
const expectedPnl = -1.27;
const expectedPnlPercent = (expectedPnl / expectedInvested) * 100;

const checks = {
  initialPrice: Number(result.initial_price) === 100,
  finalPrice: Number(result.final_price) === 102,
  ordersTriggered: Number(result.orders_triggered) === 2,
  totalInvested:
    Math.abs(Number(result.total_usdt_invested) - expectedInvested) < 1e-9,
  totalReturned:
    Math.abs(Number(result.total_usdt_returned) - expectedReturned) < 1e-9,
  totalAssetBought:
    Math.abs(Number(result.total_asset_bought) - expectedBought) < 1e-9,
  totalAssetSold:
    Math.abs(Number(result.total_asset_sold) - expectedSold) < 1e-9,
  pnl:
    Math.abs(Number(result.overall_pnl) - expectedPnl) < 1e-9,
  pnlPercent:
    Math.abs(Number(result.overall_pnl_percent) - expectedPnlPercent) < 1e-9,
  duration:
    Number(result.duration_seconds) >= 3599 &&
    Number(result.duration_seconds) <= 3601,
};

if (!Object.values(checks).every(Boolean)) {
  console.error("M47 CYCLE SUMMARY: FAIL");
  console.error({ result, checks });
  process.exit(1);
}

console.log("M47 CYCLE SUMMARY: PASS");
console.log({
  durationSeconds: result.duration_seconds,
  initialPrice: result.initial_price,
  finalPrice: result.final_price,
  ordersTriggered: result.orders_triggered,
  totalUsdtInvested: result.total_usdt_invested,
  totalUsdtReturned: result.total_usdt_returned,
  totalAssetBought: result.total_asset_bought,
  totalAssetSold: result.total_asset_sold,
  overallPnl: result.overall_pnl,
  overallPnlPercent: result.overall_pnl_percent,
});

db.close();
