import db from "../src/database/connection.js";
import "../src/database/migrations/index.js";
import ExchangeOrderRepository from "../src/database/repositories/exchangeOrderRepository.js";
import FillRepository from "../src/database/repositories/fillRepository.js";

const exchangeOrderRepository = new ExchangeOrderRepository();
const fillRepository = new FillRepository();

const suffix = `M26-${Date.now()}`;
const symbol = "M26TESTUSDT";

const cycleResult = db.prepare(`
  INSERT INTO trading_cycles (
    symbol,
    cycle_number,
    status
  )
  VALUES (?, ?, ?)
`).run(symbol, 999999, "OPEN");

const cycleId = Number(cycleResult.lastInsertRowid);

try {
  const placementResponse = {
    code: 200,
    orderId: `${suffix}-ORDER`,
    clientOrderId: `${suffix}-CLIENT`,
    symbol,
    side: "BUY",
    type: "LIMIT_MAKER",
    price: "100.25",
    origQty: "0.01",
    status: "NEW",
    nested: {
      source: "mexc",
      test: true,
    },
  };

  const finalResponse = {
    code: 200,
    orderId: placementResponse.orderId,
    status: "FILLED",
    executedQty: "0.01",
    avgPrice: "100.20",
    transactTime: 1770000000000,
    nested: {
      final: true,
    },
  };

  const fillResponse = {
    ...finalResponse,
    tradeId: `${suffix}-TRADE`,
    commission: "0.001",
    commissionAsset: "USDT",
    extraExchangeField: {
      preserved: "yes",
    },
  };

  const order = exchangeOrderRepository.create({
    tradingCycleId: cycleId,
    symbol,
    exchangeOrderId: placementResponse.orderId,
    clientOrderId: placementResponse.clientOrderId,
    side: "BUY",
    orderType: "LIMIT_MAKER",
    price: 100.25,
    quantity: 0.01,
    status: "NEW",
    placementResponse,
  });

  exchangeOrderRepository.updateFinalResponse(
    order.id,
    finalResponse,
  );

  const fill = fillRepository.create({
    exchangeOrderId: order.id,
    symbol,
    side: "BUY",
    price: 100.20,
    quantity: 0.01,
    filledAt: new Date().toISOString(),
    exchangeResponse: fillResponse,
  });

  const savedOrder = exchangeOrderRepository.findById(order.id);
  const savedFill = fillRepository.findById(fill.id);

  const savedPlacement = JSON.parse(savedOrder.placement_response_json);
  const savedFinal = JSON.parse(savedOrder.final_response_json);
  const savedFillResponse = JSON.parse(savedFill.exchange_response_json);

  if (
    savedPlacement.nested.test !== true ||
    savedPlacement.orderId !== placementResponse.orderId ||
    savedFinal.nested.final !== true ||
    savedFinal.executedQty !== "0.01" ||
    savedFillResponse.extraExchangeField.preserved !== "yes" ||
    savedFillResponse.tradeId !== fillResponse.tradeId
  ) {
    throw new Error("M26 raw exchange response persistence failed");
  }

  console.log("M26 EXCHANGE RESPONSE PERSISTENCE: PASS");
  console.log({
    placementRaw: true,
    finalRaw: true,
    fillRaw: true,
    placementOrderId: savedPlacement.orderId,
    finalStatus: savedFinal.status,
    fillTradeId: savedFillResponse.tradeId,
  });
} finally {
  db.prepare("DELETE FROM fills WHERE exchange_order_id IN (SELECT id FROM exchange_orders WHERE trading_cycle_id = ?)").run(cycleId);
  db.prepare("DELETE FROM exchange_orders WHERE trading_cycle_id = ?").run(cycleId);
  db.prepare("DELETE FROM trading_cycles WHERE id = ?").run(cycleId);
}
