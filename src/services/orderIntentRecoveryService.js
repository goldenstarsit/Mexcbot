export default class OrderIntentRecoveryService {
  constructor({
    orderIntentRepository,
    exchangeOrderRepository,
    mexcClient,
  }) {
    if (!orderIntentRepository) {
      throw new Error("Order intent repository is required");
    }

    if (!exchangeOrderRepository) {
      throw new Error("Exchange order repository is required");
    }

    if (!mexcClient) {
      throw new Error("MEXC client is required");
    }

    this.orderIntentRepository =
      orderIntentRepository;
    this.exchangeOrderRepository =
      exchangeOrderRepository;
    this.mexcClient = mexcClient;
  }

  normalizeExchangeOrderId(response) {
    return String(
      response?.orderId ??
      response?.order_id ??
      response?.id ??
      "",
    );
  }

  normalizeStatus(response) {
    return String(
      response?.status ??
      response?.orderStatus ??
      response?.data?.status ??
      "NEW",
    ).toUpperCase();
  }

  async recoverIntent(intent) {
    if (!intent) {
      throw new Error("Order intent is required");
    }

    if (
      !["PENDING", "RECOVERY_REQUIRED"].includes(
        String(intent.status ?? "").toUpperCase(),
      )
    ) {
      return {
        status: "NOT_RECOVERABLE",
        intentId: intent.id,
        intentStatus: intent.status,
      };
    }

    const response = await this.mexcClient.getOrder({
      symbol: intent.symbol,
      origClientOrderId: intent.client_order_id,
    });

    const exchangeOrderId =
      this.normalizeExchangeOrderId(response);

    if (!exchangeOrderId) {
      this.orderIntentRepository.markRecoveryRequired(
        intent.id,
        "MEXC recovery response has no order ID",
      );

      return {
        status: "RECOVERY_REQUIRED",
        intentId: intent.id,
      };
    }

    const existing =
      this.exchangeOrderRepository.findByClientOrderId(
        intent.client_order_id,
      );

    if (existing) {
      this.orderIntentRepository.markResolved(
        intent.id,
        existing.exchange_order_id,
      );

      return {
        status: "ALREADY_RECORDED",
        intentId: intent.id,
        exchangeOrderId:
          existing.exchange_order_id,
      };
    }

    const exchangeOrder =
      this.exchangeOrderRepository.create({
        tradingCycleId: intent.trading_cycle_id,
        dcaOrderId: intent.dca_order_id,
        symbol: intent.symbol,
        exchangeOrderId,
        clientOrderId: intent.client_order_id,
        side: intent.side,
        orderType: intent.order_type,
        price: Number(
          response.price ?? intent.price,
        ),
        quantity: Number(
          response.origQty ??
          response.quantity ??
          intent.quantity,
        ),
        status: this.normalizeStatus(response),
        placementResponse: response,
      });

    this.orderIntentRepository.markResolved(
      intent.id,
      exchangeOrderId,
    );

    return {
      status: "RECOVERED",
      intentId: intent.id,
      exchangeOrderId,
      exchangeOrder,
    };
  }

  async recover() {
    const intents =
      this.orderIntentRepository.findPending();

    const results = [];

    for (const intent of intents) {
      try {
        results.push(
          await this.recoverIntent(intent),
        );
      } catch (error) {
        this.orderIntentRepository.markRecoveryRequired(
          intent.id,
          error,
        );

        results.push({
          status: "RECOVERY_REQUIRED",
          intentId: intent.id,
          clientOrderId:
            intent.client_order_id,
          error: error.message,
        });
      }
    }

    return {
      checked: intents.length,
      recovered: results.filter(
        (result) =>
          result.status === "RECOVERED",
      ).length,
      alreadyRecorded: results.filter(
        (result) =>
          result.status === "ALREADY_RECORDED",
      ).length,
      recoveryRequired: results.filter(
        (result) =>
          result.status === "RECOVERY_REQUIRED",
      ).length,
      results,
    };
  }
}
