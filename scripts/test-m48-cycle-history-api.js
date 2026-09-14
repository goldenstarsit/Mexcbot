process.env.MEXCBOT_DB_PATH =
  "./data/test/m48-cycle-history-api.db";

const { mkdir, rm } = await import("node:fs/promises");

await mkdir("./data/test", { recursive: true });

try {
  await rm("./data/test/m48-cycle-history-api.db", {
    force: true,
  });
} catch {}

await import("../src/database/migrations/index.js");

const { default: TradingCycleRepository } =
  await import("../src/database/repositories/tradingCycleRepository.js");

const { default: TradingConfigApi } =
  await import("../src/api/tradingConfigApi.js");

const tradingCycleRepository =
  new TradingCycleRepository();

const configService = {
  getCurrent() {
    return {
      config: {},
      version: 1,
      updatedAt: null,
    };
  },
};

const cycle1 = tradingCycleRepository.create({
  symbol: "BTCUSDT",
  cycleNumber: 1,
});

tradingCycleRepository.updateStatus(cycle1.id, "CLOSED");

const cycle2 = tradingCycleRepository.create({
  symbol: "ETHUSDT",
  cycleNumber: 1,
});

tradingCycleRepository.updateStatus(cycle2.id, "CLOSED");

const originalFindPerformanceById =
  tradingCycleRepository.findPerformanceById.bind(
    tradingCycleRepository,
  );

const originalListPerformanceHistory =
  tradingCycleRepository.listPerformanceHistory.bind(
    tradingCycleRepository,
  );

const db = (await import("../src/database/connection.js")).default;

db.prepare(`
  UPDATE trading_cycles
  SET
    duration_seconds = 3600,
    initial_price = 100,
    final_price = 101,
    orders_triggered = 3,
    total_usdt_invested = 6,
    total_usdt_returned = 6.06,
    total_asset_bought = 0.06,
    total_asset_sold = 0.06,
    overall_pnl = 0.06,
    overall_pnl_percent = 1
  WHERE id = ?
`).run(cycle1.id);

db.prepare(`
  UPDATE trading_cycles
  SET
    duration_seconds = 7200,
    initial_price = 200,
    final_price = 198,
    orders_triggered = 2,
    total_usdt_invested = 4,
    total_usdt_returned = 3.96,
    total_asset_bought = 0.02,
    total_asset_sold = 0.02,
    overall_pnl = -0.04,
    overall_pnl_percent = -1
  WHERE id = ?
`).run(cycle2.id);

const api = new TradingConfigApi({
  tradingConfigService: configService,
  tradingCycleRepository,
  host: "127.0.0.1",
  port: 33148,
});

api.start();

const listResponse =
  await fetch("http://127.0.0.1:33148/api/cycles");

const listBody = await listResponse.json();

const symbolResponse =
  await fetch(
    "http://127.0.0.1:33148/api/cycles?symbol=BTCUSDT",
  );

const symbolBody = await symbolResponse.json();

const detailResponse =
  await fetch(
    `http://127.0.0.1:33148/api/cycles/${cycle1.id}`,
  );

const detailBody = await detailResponse.json();

const missingResponse =
  await fetch(
    "http://127.0.0.1:33148/api/cycles/999999",
  );

const pass =
  listResponse.status === 200 &&
  listBody.cycles.length === 2 &&
  symbolResponse.status === 200 &&
  symbolBody.cycles.length === 1 &&
  symbolBody.cycles[0].symbol === "BTCUSDT" &&
  symbolBody.cycles[0].overall_pnl === 0.06 &&
  detailResponse.status === 200 &&
  detailBody.cycle.id === cycle1.id &&
  detailBody.cycle.initial_price === 100 &&
  detailBody.cycle.final_price === 101 &&
  detailBody.cycle.orders_triggered === 3 &&
  detailBody.cycle.total_usdt_invested === 6 &&
  detailBody.cycle.total_usdt_returned === 6.06 &&
  detailBody.cycle.overall_pnl_percent === 1 &&
  missingResponse.status === 404 &&
  typeof originalFindPerformanceById === "function" &&
  typeof originalListPerformanceHistory === "function";

await api.stop();

db.close();

if (!pass) {
  throw new Error("M48 cycle history API test failed");
}

console.log("M48 CYCLE HISTORY API: PASS");
console.log({
  listStatus: listResponse.status,
  totalCycles: listBody.cycles.length,
  symbolFilter: symbolBody.cycles.length,
  detailStatus: detailResponse.status,
  missingStatus: missingResponse.status,
  initialPrice: detailBody.cycle.initial_price,
  finalPrice: detailBody.cycle.final_price,
  ordersTriggered: detailBody.cycle.orders_triggered,
  invested: detailBody.cycle.total_usdt_invested,
  returned: detailBody.cycle.total_usdt_returned,
  pnl: detailBody.cycle.overall_pnl,
  pnlPercent: detailBody.cycle.overall_pnl_percent,
});
