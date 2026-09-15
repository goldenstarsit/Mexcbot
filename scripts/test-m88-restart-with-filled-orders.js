import db from "../src/database/connection.js";
import TradingCycleRepository from "../src/database/repositories/tradingCycleRepository.js";
import ExchangeOrderRepository from "../src/database/repositories/exchangeOrderRepository.js";
import FillRepository from "../src/database/repositories/fillRepository.js";
import ExchangeOrderFillMonitorService from "../src/services/exchangeOrderFillMonitorService.js";

const tradingCycleRepository = new TradingCycleRepository();
const exchangeOrderRepository = new ExchangeOrderRepository();
const fillRepository = new FillRepository();

const symbol = "M88BTCUSDT";

const configSnapshot = {
  config: {
    takeProfit: 1,
    stopLoss: 50,
    dca: {
      levels: [1, 3, 6, 10, 15, 21, 28, 36, 45],
    },
  },
};

const cycle = tradingCycleRepository.create({
  symbol,
  cycleNumber: 1,
  status: "OPEN",
  configSnapshot,
});

const exchangeOrder = exchangeOrderRepository.create({
  tradingCycleId: cycle.id,
  dcaOrderId: null,
  symbol,
  exchangeOrderId: "M88-EXCHANGE-001",
  clientOrderId: "M88-CLIENT-001",
  side: "BUY",
  orderType: "LIMIT_MAKER",
  price: 100,
  quantity: 0.01,
  status: "FILLED",
  placementResponse: {
    orderId: "M88-EXCHANGE-001",
    status: "NEW",
  },
  finalResponse: {
    orderId: "M88-EXCHANGE-001",
    status: "FILLED",
    executedQty: "0.01",
  },
});

const fill = fillRepository.create({
  exchangeOrderId: exchangeOrder.id,
  exchangeTradeId: "M88-TRADE-001",
  symbol,
  side: "BUY",
  price: 100,
  quantity: 0.01,
  commission: 0,
  commissionAsset: null,
  filledAt: new Date().toISOString(),
  exchangeResponse: {
    order: {
      orderId: "M88-EXCHANGE-001",
      status: "FILLED",
    },
    trade: {
      tradeId: "M88-TRADE-001",
      price: 100,
      qty: 0.01,
    },
  },
});

const before = exchangeOrderRepository.findById(exchangeOrder.id);

if (
  before.status !== "FILLED" ||
  before.fill_processing_status !== "PENDING"
) {
  throw new Error(
    `Invalid initial recovery state: status=${before.status}, fillProcessing=${before.fill_processing_status}`,
  );
}

let initialFillBusinessCalls = 0;

const createMonitor = () =>
  new ExchangeOrderFillMonitorService({
    mexcClient: {
      async getOrder() {
        throw new Error("MEXC API must not be called for local FILLED recovery");
      },
    },
    exchangeOrderRepository,
    fillRepository,
    tradingCycleExecutionService: {
      async processInitialFill({ cycleId, symbol, fill, initialFills }) {
        initialFillBusinessCalls += 1;

        return {
          cycleId,
          symbol,
          fillId: fill.id,
          initialFillCount: initialFills.length,
        };
      },
      async processDcaFill() {
        throw new Error("DCA processing must not be called");
      },
    },
    cycleLifecycleService: {
      async completeExitAndStartNewCycle() {
        throw new Error("SELL processing must not be called");
      },
    },
    tradingConfigService: null,
  });

const monitorAfterRestart = createMonitor();

const firstRecovery = await monitorAfterRestart.processOrder({
  exchangeOrder: exchangeOrderRepository.findById(exchangeOrder.id),
  symbol,
});

const afterFirstRecovery =
  exchangeOrderRepository.findById(exchangeOrder.id);

if (firstRecovery.reason) {
  throw new Error(
    `Unexpected first recovery reason: ${firstRecovery.reason}`,
  );
}

if (firstRecovery.processed !== true) {
  throw new Error("First restart recovery did not process the fill");
}

if (afterFirstRecovery.fill_processing_status !== "PROCESSED") {
  throw new Error(
    `Fill processing was not marked PROCESSED: ${afterFirstRecovery.fill_processing_status}`,
  );
}

if (initialFillBusinessCalls !== 1) {
  throw new Error(
    `Expected exactly 1 initial-fill business call after restart, got ${initialFillBusinessCalls}`,
  );
}

const monitorSecondRestart = createMonitor();

const secondRecovery = await monitorSecondRestart.processOrder({
  exchangeOrder: exchangeOrderRepository.findById(exchangeOrder.id),
  symbol,
});

const afterSecondRecovery =
  exchangeOrderRepository.findById(exchangeOrder.id);

const storedFills =
  fillRepository.findByExchangeOrderId(exchangeOrder.id);

if (secondRecovery.reason !== "FILL_ALREADY_PROCESSED") {
  throw new Error(
    `Expected FILL_ALREADY_PROCESSED, got ${secondRecovery.reason}`,
  );
}

if (initialFillBusinessCalls !== 1) {
  throw new Error(
    `Duplicate business processing detected: ${initialFillBusinessCalls}`,
  );
}

if (storedFills.length !== 1) {
  throw new Error(
    `Expected exactly 1 stored fill, got ${storedFills.length}`,
  );
}

if (afterSecondRecovery.fill_processing_status !== "PROCESSED") {
  throw new Error(
    `Final fill processing status is ${afterSecondRecovery.fill_processing_status}`,
  );
}

console.log("M88 RESTART WITH FILLED ORDERS: PASS");
console.log({
  localFilledOrderRecovered: true,
  existingFillRecovered: true,
  firstRecoveryProcessed: firstRecovery.processed === true,
  fillProcessingStatusAfterRecovery:
    afterFirstRecovery.fill_processing_status,
  initialFillBusinessCalls,
  duplicateBusinessProcessingPrevented:
    initialFillBusinessCalls === 1,
  secondRestartBlocked:
    secondRecovery.reason === "FILL_ALREADY_PROCESSED",
  storedFillCount: storedFills.length,
  mexcApiCalled: false,
});

db.prepare("DELETE FROM trading_cycles WHERE id = ?").run(cycle.id);
