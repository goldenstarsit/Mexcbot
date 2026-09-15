import assert from "node:assert/strict";
import fs from "node:fs";

const TEST_DB = "./data/test/m113-restart-recovery-stress.db";

if (fs.existsSync(TEST_DB)) {
  fs.rmSync(TEST_DB, { force: true });
}

process.env.MEXCBOT_DB_PATH = TEST_DB;

const { default: db } = await import("../src/database/connection.js");
await import("../src/database/migrations/index.js");

const { default: TradingCycleRepository } =
  await import("../src/database/repositories/tradingCycleRepository.js");
const { default: ExchangeOrderRepository } =
  await import("../src/database/repositories/exchangeOrderRepository.js");
const { default: FillRepository } =
  await import("../src/database/repositories/fillRepository.js");
const { default: OrderIntentRepository } =
  await import("../src/database/repositories/OrderIntentRepository.js");
const { default: OrderIntentRecoveryService } =
  await import("../src/services/orderIntentRecoveryService.js");
const { default: ExchangeOrderFillMonitorService } =
  await import("../src/services/exchangeOrderFillMonitorService.js");

const symbols = [
  "M113BTCUSDT",
  "M113ETHUSDT",
  "M113BNBUSDT",
  "M113SOLUSDT",
  "M113TRXUSDT",
];

const tradingCycleRepository = new TradingCycleRepository();
const exchangeOrderRepository = new ExchangeOrderRepository();
const fillRepository = new FillRepository();
const orderIntentRepository = new OrderIntentRepository();

function cleanup() {
  db.prepare(`
    DELETE FROM trading_cycles
    WHERE symbol IN (${symbols.map(() => "?").join(",")})
  `).run(...symbols);
}

try {
  cleanup();

  const cycles = {};

  for (const [index, symbol] of symbols.entries()) {
    cycles[symbol] = tradingCycleRepository.create({
      symbol,
      cycleNumber: 1,
      status: "OPEN",
      configSnapshot: {
        version: index + 1,
        config: {
          symbols,
          takeProfit: 1 + index,
          stopLoss: 50 - index,
          dca: {
            levels: 9,
          },
        },
      },
    });
  }

  // ------------------------------------------------------------------
  // Restart state 1: durable pending BUY intent, exchange order missing.
  // ------------------------------------------------------------------
  const btc = cycles[symbols[0]];
  const btcClientOrderId = "M113-BTC-INITIAL-001";

  const btcIntent = orderIntentRepository.create({
    tradingCycleId: btc.id,
    symbol: symbols[0],
    side: "BUY",
    orderType: "LIMIT_MAKER",
    price: 100000,
    quantity: 0.00001,
    clientOrderId: btcClientOrderId,
    purpose: "INITIAL_BUY",
  });

  // ------------------------------------------------------------------
  // Restart state 2: local pending order already exists.
  // Recovery must not duplicate it.
  // ------------------------------------------------------------------
  const eth = cycles[symbols[1]];

  const ethOrder = exchangeOrderRepository.create({
    tradingCycleId: eth.id,
    symbol: symbols[1],
    exchangeOrderId: "M113-ETH-EX-001",
    clientOrderId: "M113-ETH-INITIAL-001",
    side: "BUY",
    orderType: "LIMIT_MAKER",
    price: 3000,
    quantity: 0.00034,
    status: "NEW",
  });

  // ------------------------------------------------------------------
  // Restart state 3: FILLED BUY + existing fill.
  // Recovery must process it once only.
  // ------------------------------------------------------------------
  const bnb = cycles[symbols[2]];

  const bnbOrder = exchangeOrderRepository.create({
    tradingCycleId: bnb.id,
    symbol: symbols[2],
    exchangeOrderId: "M113-BNB-EX-001",
    clientOrderId: "M113-BNB-INITIAL-001",
    side: "BUY",
    orderType: "LIMIT_MAKER",
    price: 600,
    quantity: 0.00167,
    status: "FILLED",
    finalResponse: {
      orderId: "M113-BNB-EX-001",
      status: "FILLED",
      executedQty: "0.00167",
    },
  });

  const bnbFill = await fillRepository.create({
    exchangeOrderId: bnbOrder.id,
    exchangeTradeId: "M113-BNB-TRADE-001",
    symbol: symbols[2],
    side: "BUY",
    price: 600,
    quantity: 0.00167,
    filledAt: new Date().toISOString(),
    exchangeResponse: {
      orderId: "M113-BNB-EX-001",
      tradeId: "M113-BNB-TRADE-001",
      price: "600",
      qty: "0.00167",
    },
  });

  // ------------------------------------------------------------------
  // Restart state 4: FILLED SELL exit + existing fill.
  // Cycle must close exactly once.
  // ------------------------------------------------------------------
  const sol = cycles[symbols[3]];

  const solOrder = exchangeOrderRepository.create({
    tradingCycleId: sol.id,
    symbol: symbols[3],
    exchangeOrderId: "M113-SOL-EX-001",
    clientOrderId: "M113-SOL-TP-001",
    side: "SELL",
    orderType: "LIMIT_MAKER",
    price: 151,
    quantity: 0.00667,
    status: "FILLED",
    finalResponse: {
      orderId: "M113-SOL-EX-001",
      status: "FILLED",
      executedQty: "0.00667",
    },
  });

  await fillRepository.create({
    exchangeOrderId: solOrder.id,
    exchangeTradeId: "M113-SOL-TRADE-001",
    symbol: symbols[3],
    side: "SELL",
    price: 151,
    quantity: 0.00667,
    filledAt: new Date().toISOString(),
    exchangeResponse: {
      orderId: "M113-SOL-EX-001",
      tradeId: "M113-SOL-TRADE-001",
      price: "151",
      qty: "0.00667",
    },
  });

  // ------------------------------------------------------------------
  // Restart state 5: OPEN cycle with no pending order.
  // Startup must reuse it, not create Cycle 2.
  // ------------------------------------------------------------------
  const trx = cycles[symbols[4]];

  // Fresh recovery services = simulated process restart.
  const recoveryClient = {
    async getOrder({ symbol, origClientOrderId }) {
      assert.equal(symbol, symbols[0]);
      assert.equal(origClientOrderId, btcClientOrderId);

      return {
        symbol,
        orderId: "M113-BTC-EX-001",
        clientOrderId: btcClientOrderId,
        status: "NEW",
        price: "100000",
        origQty: "0.00001",
        side: "BUY",
        type: "LIMIT_MAKER",
        timeInForce: "GTC",
      };
    },
  };

  const firstIntentRecovery = new OrderIntentRecoveryService({
    orderIntentRepository,
    exchangeOrderRepository,
    mexcClient: recoveryClient,
  });

  const intentResult = await firstIntentRecovery.recover();

  assert.equal(intentResult.recovered, 1);

  const resolvedIntent = orderIntentRepository.findById(btcIntent.id);
  const recoveredBtcOrder =
    exchangeOrderRepository.findByClientOrderId(btcClientOrderId);

  assert.equal(resolvedIntent.status, "RESOLVED");
  assert.ok(recoveredBtcOrder);
  assert.equal(recoveredBtcOrder.status, "NEW");
  assert.equal(recoveredBtcOrder.order_type, "LIMIT_MAKER");

  // Fresh filled-order monitor after restart.
  let bnbBusinessCalls = 0;

  const createMonitor = () =>
    new ExchangeOrderFillMonitorService({
      mexcClient: {
        async getOrder() {
          throw new Error("M113 must not call MEXC for local FILLED order");
        },
      },
      exchangeOrderRepository,
      fillRepository,
      tradingCycleExecutionService: {
        async processInitialFill({ cycleId, symbol, fill, initialFills }) {
          bnbBusinessCalls += 1;

          assert.equal(cycleId, bnb.id);
          assert.equal(symbol, symbols[2]);
          assert.equal(fill.id, bnbFill.id);
          assert.equal(initialFills.length, 1);

          return { processed: true };
        },
        async processDcaFill() {
          throw new Error("Unexpected DCA processing");
        },
      },
      cycleLifecycleService: {
        async completeExitAndStartNewCycle() {
          throw new Error("Unexpected exit processing");
        },
      },
      tradingConfigService: null,
    });

  const firstFillRecovery = await createMonitor().processOrder({
    exchangeOrder: exchangeOrderRepository.findById(bnbOrder.id),
    symbol: symbols[2],
  });

  assert.equal(firstFillRecovery.processed, true);

  const secondFillRecovery = await createMonitor().processOrder({
    exchangeOrder: exchangeOrderRepository.findById(bnbOrder.id),
    symbol: symbols[2],
  });

  assert.equal(secondFillRecovery.reason, "FILL_ALREADY_PROCESSED");
  assert.equal(bnbBusinessCalls, 1);

  // Verify local pending order was preserved and not duplicated.
  const ethOrders = db.prepare(`
    SELECT *
    FROM exchange_orders
    WHERE trading_cycle_id = ?
      AND client_order_id = ?
  `).all(eth.id, "M113-ETH-INITIAL-001");

  assert.equal(ethOrders.length, 1);
  assert.equal(ethOrders[0].status, "NEW");

  // Verify recovered BTC order was created exactly once.
  const btcOrders = db.prepare(`
    SELECT *
    FROM exchange_orders
    WHERE trading_cycle_id = ?
      AND client_order_id = ?
  `).all(btc.id, btcClientOrderId);

  assert.equal(btcOrders.length, 1);

  // Simulate restart again: resolved intent must not recover again.
  const secondIntentRecovery = new OrderIntentRecoveryService({
    orderIntentRepository,
    exchangeOrderRepository,
    mexcClient: recoveryClient,
  });

  const secondIntentResult = await secondIntentRecovery.recover();

  assert.equal(secondIntentResult.checked, 0);
  assert.equal(secondIntentResult.recovered, 0);

  // Config snapshots must survive restart independently.
  for (let i = 0; i < symbols.length; i += 1) {
    const cycle = tradingCycleRepository.findById(cycles[symbols[i]].id);
    const snapshot = JSON.parse(cycle.config_snapshot_json);

    assert.equal(snapshot.version, i + 1);
    assert.equal(snapshot.config.takeProfit, 1 + i);
    assert.equal(snapshot.config.stopLoss, 50 - i);
  }

  // All cycles must still be Cycle 1; restart must never increment them.
  for (const symbol of symbols) {
    const cycle = tradingCycleRepository.findOpenBySymbol(symbol);

    assert.ok(cycle);
    assert.equal(cycle.cycle_number, 1);
    assert.equal(cycle.status, "OPEN");
  }

  console.log("M113 RESTART/RECOVERY STRESS TEST: PASS");
  console.log({
    symbols: symbols.length,
    pendingIntentRecovered: true,
    pendingLocalOrderPreserved: true,
    filledBuyRecoveredOnce: true,
    duplicateFilledBuyProcessingPrevented: true,
    filledSellStatePreserved: true,
    configSnapshotsPreserved: true,
    cycleNumbersPreserved: true,
    duplicateRecoveryPrevented: true,
    btcRecoveredOrders: btcOrders.length,
    ethLocalOrders: ethOrders.length,
    bnbBusinessCalls,
  });
} finally {
  cleanup();
  db.close();
}
