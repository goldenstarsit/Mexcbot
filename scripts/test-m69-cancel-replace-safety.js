import CancelReplaceService from "../src/services/cancelReplaceService.js";

const orders = new Map([
  [
    1,
    {
      id: 1,
      symbol: "BTCUSDT",
      exchange_order_id: "M69-OLD",
      client_order_id: "mxc-c1-dca-1",
      side: "BUY",
      status: "NEW",
    },
  ],
  [
    2,
    {
      id: 2,
      symbol: "BTCUSDT",
      exchange_order_id: "M69-FILLED",
      client_order_id: "mxc-c1-dca-2",
      side: "BUY",
      status: "FILLED",
    },
  ],
]);

const calls = [];

const exchangeOrderRepository = {
  findByExchangeOrderId(id) {
    return [...orders.values()].find(
      (order) => order.exchange_order_id === id,
    ) ?? null;
  },

  findByClientOrderId(id) {
    return [...orders.values()].find(
      (order) => order.client_order_id === id,
    ) ?? null;
  },

  updateStatus(id, status) {
    const order = orders.get(id);
    order.status = status;
    return { ...order };
  },

  updateFinalResponse(id, response) {
    const order = orders.get(id);
    order.final_response = response;
    return { ...order };
  },
};

const mexcClient = {
  async cancelOrder(params) {
    calls.push(["cancel", params]);

    return {
      symbol: "BTCUSDT",
      orderId: "M69-OLD",
      clientOrderId: "mxc-c1-dca-1",
      status: "CANCELED",
    };
  },
};

const service = new CancelReplaceService({
  mexcClient,
  exchangeOrderRepository,
});

const cancelled = await service.cancel({
  exchangeOrderId: "M69-OLD",
});

if (cancelled.reason !== "ORDER_CANCELED") {
  throw new Error("Active order must be canceled");
}

if (orders.get(1).status !== "CANCELED") {
  throw new Error("Local order status must become CANCELED");
}

const alreadyFilled = await service.cancel({
  exchangeOrderId: "M69-FILLED",
});

if (alreadyFilled.reason !== "ORDER_ALREADY_TERMINAL") {
  throw new Error("Filled order must not be canceled");
}

let replacementCalls = 0;

const replaced = await service.cancelAndReplace({
  exchangeOrderId: "M69-OLD",
  newPrice: 99,
  newQuantity: 0.01,
  placeReplacement: async (params) => {
    replacementCalls += 1;

    if (params.previousExchangeOrderId !== "M69-OLD") {
      throw new Error("Previous order identity was not preserved");
    }

    return {
      orderId: "M69-NEW",
      status: "NEW",
      price: params.price,
      quantity: params.quantity,
    };
  },
});

if (replaced.reason !== "ORDER_ALREADY_TERMINAL") {
  throw new Error("Already canceled order must not be replaced");
}

orders.get(1).status = "NEW";

const successfulReplace = await service.cancelAndReplace({
  exchangeOrderId: "M69-OLD",
  newPrice: 98,
  newQuantity: 0.02,
  placeReplacement: async (params) => {
    replacementCalls += 1;

    if (params.previousExchangeOrderId !== "M69-OLD") {
      throw new Error("Previous order identity was not preserved");
    }

    return {
      orderId: "M69-NEW",
      status: "NEW",
      price: params.price,
      quantity: params.quantity,
    };
  },
});

if (!successfulReplace.replaced) {
  throw new Error("Cancel/replace should succeed");
}

if (replacementCalls !== 1) {
  throw new Error("Replacement must be placed exactly once");
}

if (calls.length !== 2) {
  throw new Error("Cancel must only reach exchange for active orders");
}

console.log("M69 CANCEL/REPLACE SAFETY: PASS");
console.log({
  canceled: cancelled.reason,
  filledProtection: alreadyFilled.reason,
  replaced: successfulReplace.replaced,
  replacementCalls,
  cancelExchangeCalls: calls.length,
});
