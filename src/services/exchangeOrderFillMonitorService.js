export default class ExchangeOrderFillMonitorService {
  constructor({
    mexcClient,
    exchangeOrderRepository,
    fillRepository,
    tradingCycleExecutionService,
    cycleLifecycleService,
  }) {
    this.mexcClient = mexcClient;
    this.exchangeOrderRepository = exchangeOrderRepository;
    this.fillRepository = fillRepository;
    this.tradingCycleExecutionService = tradingCycleExecutionService;
    this.cycleLifecycleService = cycleLifecycleService;
  }

  async checkOrder({ exchangeOrder, symbol }) {
    if (!exchangeOrder) {
      throw new Error("Exchange order is required");
    }

    if (!symbol) {
      throw new Error("Symbol is required");
    }

    const exchangeOrderId = String(
      exchangeOrder.exchange_order_id ??
      exchangeOrder.exchangeOrderId ??
      "",
    );

    if (!exchangeOrderId) {
      throw new Error("Exchange order ID is required");
    }

    const result = await this.mexcClient.getOrder({
      symbol,
      orderId: exchangeOrderId,
    });

    const status = String(
      result?.status ??
      result?.orderStatus ??
      result?.data?.status ??
      "",
    ).toUpperCase();

    return {
      exchangeOrder,
      exchangeOrderId,
      status,
      response: result,
    };
  }

  isInitialBuy(exchangeOrder) {
    if (exchangeOrder.side !== "BUY") {
      return false;
    }

    const cycleOrders =
      this.exchangeOrderRepository.findByCycleId(
        exchangeOrder.trading_cycle_id,
      );

    const buyOrders = cycleOrders
      .filter((order) => order.side === "BUY")
      .sort((a, b) => Number(a.id) - Number(b.id));

    return (
      buyOrders.length > 0 &&
      Number(buyOrders[0].id) === Number(exchangeOrder.id)
    );
  }

  async processOrder({ exchangeOrder, symbol }) {
    if (!exchangeOrder) {
      throw new Error("Exchange order is required");
    }

    if (String(exchangeOrder.status).toUpperCase() === "FILLED") {
      return {
        processed: false,
        reason: "ALREADY_FILLED",
      };
    }

    const checked = await this.checkOrder({
      exchangeOrder,
      symbol,
    });

    if (
      ["CANCELED", "CANCELLED", "REJECTED", "EXPIRED"].includes(
        checked.status,
      )
    ) {
      this.exchangeOrderRepository.updateStatus(
        exchangeOrder.id,
        checked.status,
      );

      return {
        ...checked,
        processed: false,
      };
    }

    if (checked.status !== "FILLED") {
      return {
        ...checked,
        processed: false,
      };
    }

    const response = checked.response;

    const quantity = Number(
      response?.executedQty ??
      response?.cummulativeQuantity ??
      response?.origQty ??
      exchangeOrder.quantity,
    );

    const price = Number(
      response?.avgPrice ??
      response?.price ??
      exchangeOrder.price,
    );

    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("Filled quantity is invalid");
    }

    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("Filled price is invalid");
    }

    const existingFills =
      this.fillRepository.findByExchangeOrderId(
        exchangeOrder.id,
      );

    if (existingFills.length > 0) {
      this.exchangeOrderRepository.updateStatus(
        exchangeOrder.id,
        "FILLED",
      );

      return {
        ...checked,
        processed: false,
        reason: "FILL_ALREADY_RECORDED",
        fill: existingFills[0],
      };
    }

    const fill = this.fillRepository.create({
      exchangeOrderId: exchangeOrder.id,
      symbol,
      side: exchangeOrder.side,
      quantity,
      price,
      filledAt:
        response?.time ??
        response?.transactTime ??
        new Date().toISOString(),
    });

    this.exchangeOrderRepository.updateStatus(
      exchangeOrder.id,
      "FILLED",
    );

    if (exchangeOrder.side === "BUY") {
      if (this.isInitialBuy(exchangeOrder)) {
        const result =
          await this.tradingCycleExecutionService.processInitialFill({
            cycleId: exchangeOrder.trading_cycle_id,
            symbol,
            fill,
          });

        return {
          ...checked,
          processed: true,
          fill,
          action: "INITIAL_FILL_PROCESSED",
          result,
        };
      }

      const cycleFills =
        this.fillRepository.findByCycleId(
          exchangeOrder.trading_cycle_id,
        );

      const result =
        await this.tradingCycleExecutionService.processDcaFill({
          cycleId: exchangeOrder.trading_cycle_id,
          fills: cycleFills,
        });

      return {
        ...checked,
        processed: true,
        fill,
        action: "DCA_FILL_PROCESSED",
        result,
      };
    }

    if (exchangeOrder.side === "SELL") {
      const result =
        await this.cycleLifecycleService.completeExitAndStartNewCycle({
          cycleId: exchangeOrder.trading_cycle_id,
          symbol,
          fill,
        });

      return {
        ...checked,
        processed: true,
        fill,
        action: "EXIT_FILL_PROCESSED",
        result,
      };
    }

    throw new Error(
      `Unsupported order side: ${exchangeOrder.side}`,
    );
  }
}
