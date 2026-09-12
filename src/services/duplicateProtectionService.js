export default class DuplicateProtectionService {
  constructor({
    mexcClient,
    exchangeOrderRepository,
    makerOrderEngine,
  }) {
    this.mexcClient = mexcClient;
    this.exchangeOrderRepository = exchangeOrderRepository;
    this.makerOrderEngine = makerOrderEngine;
  }

  createClientOrderId({ cycleId, kind, id = null }) {
    if (!Number.isInteger(cycleId) || cycleId <= 0) {
      throw new Error("Valid cycleId is required");
    }

    const suffix = id === null ? "" : `-${id}`;
    return `mxc-c${cycleId}-${kind}${suffix}`;
  }

  async findExisting({ symbol, clientOrderId }) {
    const local =
      this.exchangeOrderRepository.findByClientOrderId(
        clientOrderId,
      );

    if (local) {
      return {
        source: "LOCAL",
        exchangeOrder: local,
      };
    }

    try {
      const remote = await this.mexcClient.getOrder({
        symbol,
        origClientOrderId: clientOrderId,
      });

      if (remote?.orderId || remote?.order_id) {
        return {
          source: "EXCHANGE",
          response: remote,
        };
      }
    } catch (error) {
      const message = String(error?.message ?? error).toLowerCase();

      if (
        !(
          message.includes("order") &&
          (
            message.includes("not found") ||
            message.includes("not exist") ||
            message.includes("does not exist")
          )
        )
      ) {
        throw error;
      }
    }

    return null;
  }

  async placeBuy({
    tradingCycleId,
    dcaOrderId = null,
    symbol,
    quantity,
    price,
    bestAsk,
    clientOrderId,
  }) {
    const existing = await this.findExisting({
      symbol,
      clientOrderId,
    });

    if (existing?.source === "LOCAL") {
      return {
        reused: true,
        source: "LOCAL",
        exchangeOrder: existing.exchangeOrder,
      };
    }

    if (existing?.source === "EXCHANGE") {
      const response = existing.response;
      const exchangeOrder =
        await this.exchangeOrderRepository.create({
          tradingCycleId,
          dcaOrderId,
          symbol,
          exchangeOrderId: String(
            response.orderId ??
            response.order_id ??
            response.id ??
            "",
          ),
          clientOrderId,
          side: "BUY",
          orderType: "LIMIT_MAKER",
          price: Number(response.price ?? price),
          quantity: Number(
            response.origQty ??
            response.quantity ??
            quantity,
          ),
          status: String(response.status ?? "NEW").toUpperCase(),
        });

      return {
        reused: true,
        source: "EXCHANGE",
        exchangeOrder,
      };
    }

    const order = await this.makerOrderEngine.placeBuy({
      symbol,
      quantity,
      price,
      bestAsk,
      clientOrderId,
    });

    const exchangeOrderId = String(
      order.orderId ??
      order.order_id ??
      order.id ??
      "",
    );

    if (!exchangeOrderId) {
      throw new Error("MEXC exchange order ID is missing");
    }

    const exchangeOrder =
      await this.exchangeOrderRepository.create({
        tradingCycleId,
        dcaOrderId,
        symbol,
        exchangeOrderId,
        clientOrderId,
        side: "BUY",
        orderType: "LIMIT_MAKER",
        price,
        quantity,
        status: "NEW",
      });

    return {
      reused: false,
      source: "NEW",
      exchangeOrder,
    };
  }

  async placeSell({
    tradingCycleId,
    symbol,
    quantity,
    price,
    bestBid,
    clientOrderId,
    reason,
  }) {
    const existing = await this.findExisting({
      symbol,
      clientOrderId,
    });

    if (existing?.source === "LOCAL") {
      return {
        reused: true,
        source: "LOCAL",
        exchangeOrder: existing.exchangeOrder,
      };
    }

    if (existing?.source === "EXCHANGE") {
      const response = existing.response;
      const exchangeOrder =
        await this.exchangeOrderRepository.create({
          tradingCycleId,
          symbol,
          exchangeOrderId: String(
            response.orderId ??
            response.order_id ??
            response.id ??
            "",
          ),
          clientOrderId,
          side: "SELL",
          orderType: "LIMIT_MAKER",
          price: Number(response.price ?? price),
          quantity: Number(
            response.origQty ??
            response.quantity ??
            quantity,
          ),
          status: String(response.status ?? "NEW").toUpperCase(),
        });

      return {
        reused: true,
        source: "EXCHANGE",
        reason,
        exchangeOrder,
      };
    }

    const order = await this.makerOrderEngine.placeSell({
      symbol,
      quantity,
      price,
      bestBid,
      clientOrderId,
    });

    const exchangeOrderId = String(
      order.orderId ??
      order.order_id ??
      order.id ??
      "",
    );

    if (!exchangeOrderId) {
      throw new Error("MEXC exchange order ID is missing");
    }

    const exchangeOrder =
      await this.exchangeOrderRepository.create({
        tradingCycleId,
        symbol,
        exchangeOrderId,
        clientOrderId,
        side: "SELL",
        orderType: "LIMIT_MAKER",
        price,
        quantity,
        status: "NEW",
      });

    return {
      reused: false,
      source: "NEW",
      reason,
      exchangeOrder,
    };
  }
}
