export default class CancelReplaceService {
  constructor({
    mexcClient,
    exchangeOrderRepository,
  }) {
    if (!mexcClient) {
      throw new Error("MEXC client is required");
    }

    if (!exchangeOrderRepository) {
      throw new Error("Exchange order repository is required");
    }

    this.mexcClient = mexcClient;
    this.exchangeOrderRepository = exchangeOrderRepository;
  }

  isTerminalStatus(status) {
    return [
      "CANCELED",
      "CANCELLED",
      "REJECTED",
      "EXPIRED",
      "FILLED",
    ].includes(String(status ?? "").toUpperCase());
  }

  async cancel({
    exchangeOrderId,
    symbol,
    clientOrderId = null,
  }) {
    if (!exchangeOrderId && !clientOrderId) {
      throw new Error(
        "Exchange order ID or client order ID is required",
      );
    }

    const local = exchangeOrderId
      ? this.exchangeOrderRepository.findByExchangeOrderId(
          exchangeOrderId,
        )
      : this.exchangeOrderRepository.findByClientOrderId(
          clientOrderId,
        );

    if (!local) {
      throw new Error("Local exchange order was not found");
    }

    const currentStatus = String(
      local.status ?? "",
    ).toUpperCase();

    if (this.isTerminalStatus(currentStatus)) {
      return {
        changed: false,
        reason: "ORDER_ALREADY_TERMINAL",
        exchangeOrder: local,
      };
    }

    let response;

    try {
      response = await this.mexcClient.cancelOrder({
        symbol: local.symbol ?? symbol,
        orderId:
          local.exchange_order_id ??
          exchangeOrderId,
        origClientOrderId:
          local.client_order_id ??
          clientOrderId,
      });
    } catch (error) {
      throw new Error(
        `Cancel order failed: ${error?.message ?? error}`,
      );
    }

    const responseStatus = String(
      response?.status ?? "CANCELED",
    ).toUpperCase();

    const updated =
      this.exchangeOrderRepository.updateStatus(
        local.id,
        responseStatus,
      );

    this.exchangeOrderRepository.updateFinalResponse(
      local.id,
      response,
    );

    return {
      changed: true,
      reason: "ORDER_CANCELED",
      exchangeOrder: updated,
      response,
    };
  }

  async cancelAndReplace({
    exchangeOrderId,
    symbol,
    clientOrderId = null,
    newPrice,
    newQuantity,
    placeReplacement,
  }) {
    if (typeof placeReplacement !== "function") {
      throw new Error(
        "Replacement placement function is required",
      );
    }

    if (!Number.isFinite(Number(newPrice)) || Number(newPrice) <= 0) {
      throw new Error("Replacement price must be greater than 0");
    }

    if (
      !Number.isFinite(Number(newQuantity)) ||
      Number(newQuantity) <= 0
    ) {
      throw new Error(
        "Replacement quantity must be greater than 0",
      );
    }

    const local = exchangeOrderId
      ? this.exchangeOrderRepository.findByExchangeOrderId(
          exchangeOrderId,
        )
      : this.exchangeOrderRepository.findByClientOrderId(
          clientOrderId,
        );

    if (!local) {
      throw new Error("Local exchange order was not found");
    }

    const currentStatus = String(
      local.status ?? "",
    ).toUpperCase();

    if (currentStatus === "FILLED") {
      return {
        replaced: false,
        reason: "ORDER_ALREADY_FILLED",
        exchangeOrder: local,
      };
    }

    if (
      [
        "CANCELED",
        "CANCELLED",
        "REJECTED",
        "EXPIRED",
      ].includes(currentStatus)
    ) {
      return {
        replaced: false,
        reason: "ORDER_ALREADY_TERMINAL",
        exchangeOrder: local,
      };
    }

    const cancelled = await this.cancel({
      exchangeOrderId:
        local.exchange_order_id ?? exchangeOrderId,
      symbol: local.symbol ?? symbol,
      clientOrderId:
        local.client_order_id ?? clientOrderId,
    });

    if (!cancelled.changed) {
      return {
        replaced: false,
        reason: cancelled.reason,
        exchangeOrder: cancelled.exchangeOrder,
      };
    }

    const replacement = await placeReplacement({
      symbol: local.symbol ?? symbol,
      side: local.side,
      quantity: Number(newQuantity),
      price: Number(newPrice),
      previousExchangeOrderId:
        local.exchange_order_id,
      previousClientOrderId:
        local.client_order_id,
    });

    return {
      replaced: true,
      cancelled: cancelled.exchangeOrder,
      replacement,
    };
  }
}
