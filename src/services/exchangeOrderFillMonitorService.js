import tradingConfig from "../config/trading.config.js";

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
    this.tradingCycleExecutionService =
      tradingCycleExecutionService;
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

  async processBusinessFill({
    exchangeOrder,
    symbol,
    fill,
  }) {
    if (exchangeOrder.side === "BUY") {
      if (this.isInitialBuy(exchangeOrder)) {
        const result =
          await this.tradingCycleExecutionService.processInitialFill({
            cycleId: exchangeOrder.trading_cycle_id,
            symbol,
            fill,
          });

        return {
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
        action: "EXIT_FILL_PROCESSED",
        result,
      };
    }

    throw new Error(
      `Unsupported order side: ${exchangeOrder.side}`,
    );
  }

  async processExistingFill({
    exchangeOrder,
    symbol,
    fill,
    checked,
  }) {
    this.exchangeOrderRepository.markFillProcessing(
      exchangeOrder.id,
    );

    try {
      const business = await this.processBusinessFill({
        exchangeOrder,
        symbol,
        fill,
      });

      const updatedOrder =
        this.exchangeOrderRepository.markFillProcessed(
          exchangeOrder.id,
        );

      return {
        ...checked,
        processed: true,
        fill,
        ...business,
        processingStatus:
          updatedOrder.fill_processing_status,
        processingAttempts:
          updatedOrder.fill_processing_attempts,
      };
    } catch (error) {
      const failedOrder =
        this.exchangeOrderRepository.markFillProcessingFailed(
          exchangeOrder.id,
          error,
        );

      throw Object.assign(error, {
        fillProcessingStatus:
          failedOrder.fill_processing_status,
        fillProcessingAttempts:
          failedOrder.fill_processing_attempts,
      });
    }
  }

  async processOrder({ exchangeOrder, symbol }) {
    if (!exchangeOrder) {
      throw new Error("Exchange order is required");
    }

    if (!symbol) {
      throw new Error("Symbol is required");
    }

    const fillProcessingStatus = String(
      exchangeOrder.fill_processing_status ?? "PENDING",
    ).toUpperCase();

    if (fillProcessingStatus === "PROCESSED") {
      return {
        processed: false,
        reason: "FILL_ALREADY_PROCESSED",
      };
    }

    const fillProcessingAttempts = Number(
      exchangeOrder.fill_processing_attempts ?? 0,
    );

    if (
      fillProcessingStatus === "EXHAUSTED" ||
      (
        fillProcessingAttempts >=
        this.maxFillProcessingAttempts &&
        ["PENDING", "FAILED", "PROCESSING"].includes(
          fillProcessingStatus,
        )
      )
    ) {
      const exhaustedOrder =
        this.exchangeOrderRepository.markFillProcessingExhausted(
          exchangeOrder.id,
          `Maximum fill processing attempts reached: ${this.maxFillProcessingAttempts}`,
        );

      return {
        processed: false,
        reason: "FILL_PROCESSING_EXHAUSTED",
        processingStatus:
          exhaustedOrder.fill_processing_status,
        processingAttempts:
          exhaustedOrder.fill_processing_attempts,
        maxAttempts:
          this.maxFillProcessingAttempts,
      };
    }

    if (
      String(exchangeOrder.status).toUpperCase() === "FILLED" &&
      ["PENDING", "FAILED"].includes(
        String(exchangeOrder.fill_processing_status).toUpperCase(),
      )
    ) {
      const existingFills =
        this.fillRepository.findByExchangeOrderId(
          exchangeOrder.id,
        );

      if (existingFills.length === 0) {
        throw new Error(
          "FILLED exchange order has no recorded fill",
        );
      }

      return this.processExistingFill({
        exchangeOrder,
        symbol,
        fill: existingFills[0],
        checked: {
          exchangeOrder,
          exchangeOrderId: exchangeOrder.exchange_order_id,
          status: "FILLED",
        },
      });
    }

    const checked = await this.checkOrder({
      exchangeOrder,
      symbol,
    });

    this.exchangeOrderRepository.updateFinalResponse(
      exchangeOrder.id,
      checked.response,
    );

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

      return this.processExistingFill({
        exchangeOrder: this.exchangeOrderRepository.findById(
          exchangeOrder.id,
        ),
        symbol,
        fill: existingFills[0],
        checked: {
          ...checked,
          status: "FILLED",
        },
      });
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
      exchangeResponse: response,
    });

    this.exchangeOrderRepository.updateStatus(
      exchangeOrder.id,
      "FILLED",
    );

    return this.processExistingFill({
      exchangeOrder: this.exchangeOrderRepository.findById(
        exchangeOrder.id,
      ),
      symbol,
      fill,
      checked: {
        ...checked,
        status: "FILLED",
      },
    });
  }
}
