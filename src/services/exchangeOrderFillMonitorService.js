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

  async checkOrder({
    exchangeOrder,
    symbol,
  }) {
    if (!exchangeOrder) {
      throw new Error("Exchange order is required");
    }

    if (!symbol) {
      throw new Error("Symbol is required");
    }

    const exchangeOrderId = String(
      exchangeOrder.exchangeOrderId ??
      exchangeOrder.orderId ??
      exchangeOrder.order_id ??
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
      result.status ??
      result.orderStatus ??
      "",
    ).toUpperCase();

    return {
      exchangeOrder,
      exchangeOrderId,
      status,
      response: result,
    };
  }

  async processOrder({
    exchangeOrder,
    symbol,
  }) {
    const checked = await this.checkOrder({
      exchangeOrder,
      symbol,
    });

    if (checked.status !== "FILLED") {
      return {
        ...checked,
        processed: false,
      };
    }

    const response = checked.response;

    const quantity = Number(
      response.executedQty ??
      response.cummulativeQuantity ??
      response.origQty ??
      exchangeOrder.quantity,
    );

    const price = Number(
      response.avgPrice ??
      response.price ??
      exchangeOrder.price,
    );

    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("Filled quantity is invalid");
    }

    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("Filled price is invalid");
    }

    const fill = await this.fillRepository.create({
      exchangeOrderId: exchangeOrder.id,
      symbol,
      side: exchangeOrder.side,
      quantity,
      price,
    });

    await this.exchangeOrderRepository.updateStatus(
      exchangeOrder.id,
      "FILLED",
    );

    if (exchangeOrder.side === "BUY") {
      const isInitialOrder =
        exchangeOrder.orderNumber === 1 ||
        exchangeOrder.isInitial === true ||
        exchangeOrder.role === "INITIAL";

      if (isInitialOrder) {
        const result =
          await this.tradingCycleExecutionService.processInitialFill({
            cycleId: exchangeOrder.cycleId,
            symbol,
            fill: {
              price,
              quantity,
            },
          });

        return {
          ...checked,
          processed: true,
          fill,
          action: "INITIAL_FILL_PROCESSED",
          result,
        };
      }

      const existingFills =
        await this.fillRepository.findBySymbol(symbol);

      const result =
        this.tradingCycleExecutionService.processDcaFill({
          cycleId: exchangeOrder.cycleId,
          fills: existingFills,
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
          cycleId: exchangeOrder.cycleId,
          symbol,
          fill: {
            side: "SELL",
            price,
            quantity,
          },
        });

      return {
        ...checked,
        processed: true,
        fill,
        action: "EXIT_FILL_PROCESSED",
        result,
      };
    }

    throw new Error(`Unsupported order side: ${exchangeOrder.side}`);
  }
}
