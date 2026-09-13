export default class DuplicateProtectionService {
  constructor({
    mexcClient,
    exchangeOrderRepository,
    makerOrderEngine,
    orderIntentRepository,
  }) {
    this.mexcClient = mexcClient;
    this.exchangeOrderRepository = exchangeOrderRepository;
    this.makerOrderEngine = makerOrderEngine;
    this.orderIntentRepository = orderIntentRepository;
  }

  createClientOrderId({ cycleId, kind, id = null }) {
    if (!Number.isInteger(cycleId) || cycleId <= 0) {
      throw new Error("Valid cycleId is required");
    }

    const suffix = id === null ? "" : `-${id}`;
    return `mxc-c${cycleId}-${kind}${suffix}`;
  }

  createOrderIntent({
    tradingCycleId,
    dcaOrderId = null,
    symbol,
    side,
    quantity,
    price,
    clientOrderId,
    purpose,
  }) {
    if (!this.orderIntentRepository) {
      throw new Error("Order intent repository is required");
    }

    const existing =
      this.orderIntentRepository.findByClientOrderId(
        clientOrderId,
      );

    if (existing) {
      return existing;
    }

    return this.orderIntentRepository.create({
      tradingCycleId,
      dcaOrderId,
      symbol,
      side,
      orderType: "LIMIT_MAKER",
      price,
      quantity,
      clientOrderId,
      purpose,
    });
  }

  resolveOrderIntent(intent, exchangeOrderId) {
    this.orderIntentRepository.markExchangePlaced(
      intent.id,
      exchangeOrderId,
    );

    return this.orderIntentRepository.markResolved(
      intent.id,
      exchangeOrderId,
    );
  }

  async findExisting({ symbol, clientOrderId }) {
    const local =
      this.exchangeOrderRepository.findByClientOrderId(
        clientOrderId,
      );

    if (local) {
      const terminalStatuses = [
        "CANCELED",
        "CANCELLED",
        "REJECTED",
        "EXPIRED",
      ];

      if (
        !terminalStatuses.includes(
          String(local.status ?? "").toUpperCase(),
        )
      ) {
        return {
          source: "LOCAL",
          exchangeOrder: local,
        };
      }
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
    purpose = null,
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

    const resolvedPurpose =
      purpose ??
      (
        dcaOrderId === null || dcaOrderId === undefined
          ? "initial"
          : "dca"
      );

    const orderIntent = this.createOrderIntent({
      tradingCycleId,
      dcaOrderId,
      symbol,
      side: "BUY",
      quantity,
      price,
      clientOrderId,
      purpose: resolvedPurpose,
    });

    if (existing?.source === "EXCHANGE") {
      const response = existing.response;
      const exchangeOrderId = String(
        response.orderId ??
        response.order_id ??
        response.id ??
        "",
      );

      if (!exchangeOrderId) {
        this.orderIntentRepository.markRecoveryRequired(
          orderIntent.id,
          "Recovered exchange order has no order ID",
        );
        throw new Error(
          "Recovered MEXC exchange order ID is missing",
        );
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
          price: Number(response.price ?? price),
          quantity: Number(
            response.origQty ??
            response.quantity ??
            quantity,
          ),
          status: String(
            response.status ?? "NEW",
          ).toUpperCase(),
          placementResponse: response,
        });

      this.resolveOrderIntent(
        orderIntent,
        exchangeOrderId,
      );

      return {
        reused: true,
        source: "EXCHANGE",
        exchangeOrder,
      };
    }

    let order;

    try {
      order = await this.makerOrderEngine.placeBuy({
        symbol,
        quantity,
        price,
        bestAsk,
        clientOrderId,
      });
    } catch (error) {
      this.orderIntentRepository.markRecoveryRequired(
        orderIntent.id,
        error,
      );
      throw error;
    }

    const exchangeOrderId = String(
      order.orderId ??
      order.order_id ??
      order.id ??
      "",
    );

    if (!exchangeOrderId) {
      this.orderIntentRepository.markRecoveryRequired(
        orderIntent.id,
        "MEXC exchange order ID is missing",
      );
      throw new Error(
        "MEXC exchange order ID is missing",
      );
    }

    let exchangeOrder;

    try {
      exchangeOrder =
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
          placementResponse: order,
        });
    } catch (error) {
      this.orderIntentRepository.markRecoveryRequired(
        orderIntent.id,
        error,
      );
      throw error;
    }

    this.resolveOrderIntent(
      orderIntent,
      exchangeOrderId,
    );

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
    purpose = "exit",
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

    const orderIntent = this.createOrderIntent({
      tradingCycleId,
      symbol,
      side: "SELL",
      quantity,
      price,
      clientOrderId,
      purpose,
    });

    if (existing?.source === "EXCHANGE") {
      const response = existing.response;
      const exchangeOrderId = String(
        response.orderId ??
        response.order_id ??
        response.id ??
        "",
      );

      if (!exchangeOrderId) {
        this.orderIntentRepository.markRecoveryRequired(
          orderIntent.id,
          "Recovered exchange order has no order ID",
        );
        throw new Error(
          "Recovered MEXC exchange order ID is missing",
        );
      }

      const exchangeOrder =
        await this.exchangeOrderRepository.create({
          tradingCycleId,
          symbol,
          exchangeOrderId,
          clientOrderId,
          side: "SELL",
          orderType: "LIMIT_MAKER",
          price: Number(response.price ?? price),
          quantity: Number(
            response.origQty ??
            response.quantity ??
            quantity,
          ),
          status: String(
            response.status ?? "NEW",
          ).toUpperCase(),
          placementResponse: response,
        });

      this.resolveOrderIntent(
        orderIntent,
        exchangeOrderId,
      );

      return {
        reused: true,
        source: "EXCHANGE",
        reason,
        exchangeOrder,
      };
    }

    let order;

    try {
      order = await this.makerOrderEngine.placeSell({
        symbol,
        quantity,
        price,
        bestBid,
        clientOrderId,
      });
    } catch (error) {
      this.orderIntentRepository.markRecoveryRequired(
        orderIntent.id,
        error,
      );
      throw error;
    }

    const exchangeOrderId = String(
      order.orderId ??
      order.order_id ??
      order.id ??
      "",
    );

    if (!exchangeOrderId) {
      this.orderIntentRepository.markRecoveryRequired(
        orderIntent.id,
        "MEXC exchange order ID is missing",
      );
      throw new Error(
        "MEXC exchange order ID is missing",
      );
    }

    let exchangeOrder;

    try {
      exchangeOrder =
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
          placementResponse: order,
        });
    } catch (error) {
      this.orderIntentRepository.markRecoveryRequired(
        orderIntent.id,
        error,
      );
      throw error;
    }

    this.resolveOrderIntent(
      orderIntent,
      exchangeOrderId,
    );

    return {
      reused: false,
      source: "NEW",
      reason,
      exchangeOrder,
    };
  }
}
