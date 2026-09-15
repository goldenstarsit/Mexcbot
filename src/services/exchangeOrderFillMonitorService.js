import tradingConfig from "../config/trading.config.js";

export default class ExchangeOrderFillMonitorService {
  constructor({
    mexcClient,
    exchangeOrderRepository,
    fillRepository,
    tradingCycleExecutionService,
    cycleLifecycleService,
    tradingConfigService,
  }) {
    this.mexcClient = mexcClient;
    this.exchangeOrderRepository = exchangeOrderRepository;
    this.fillRepository = fillRepository;
    this.tradingCycleExecutionService =
      tradingCycleExecutionService;
    this.cycleLifecycleService = cycleLifecycleService;
    this.tradingConfigService = tradingConfigService;

    this.maxFillProcessingAttempts =
      this.getMaxFillProcessingAttempts();
  }

  getMaxFillProcessingAttempts() {
    const configuredMaxAttempts =
      this.tradingConfigService
        ? this.tradingConfigService.getCurrent().config
            ?.fillProcessing?.maxAttempts
        : tradingConfig?.fillProcessing?.maxAttempts;

    return Number.isInteger(configuredMaxAttempts) &&
      configuredMaxAttempts > 0
      ? configuredMaxAttempts
      : 5;
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
    checked,
  }) {
    if (exchangeOrder.side === "BUY") {
      const orderFills =
        this.fillRepository.findByExchangeOrderId(
          exchangeOrder.id,
        );

      const firstFillOfOrder =
        orderFills.length > 0
          ? orderFills[0]
          : null;

      const isFirstFillOfOrder =
        firstFillOfOrder !== null &&
        Number(firstFillOfOrder.id) === Number(fill.id);

      if (
        this.isInitialBuy(exchangeOrder) &&
        isFirstFillOfOrder
      ) {
        const result =
          await this.tradingCycleExecutionService.processInitialFill({
            cycleId: exchangeOrder.trading_cycle_id,
            symbol,
            fill,
            initialFills: orderFills,
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
        action: "PARTIAL_OR_DCA_FILL_PROCESSED",
        result,
      };
    }

    if (exchangeOrder.side === "SELL") {
      if (checked.status !== "FILLED") {
        return {
          action: "PARTIAL_SELL_FILL_RECORDED",
          result: null,
        };
      }

      const orderFills =
        this.fillRepository.findByExchangeOrderId(
          exchangeOrder.id,
        );

      const latestFill =
        orderFills.length > 0
          ? orderFills[orderFills.length - 1]
          : null;

      if (
        latestFill &&
        Number(latestFill.id) !== Number(fill.id)
      ) {
        return {
          action: "SELL_FILL_RECORDED",
          result: null,
        };
      }

      const result =
        await this.cycleLifecycleService.completeExitAndStartNewCycle({
          cycleId: exchangeOrder.trading_cycle_id,
          symbol,
          fill,
          exchangeOrder,
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
        checked,
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

  recoverExhaustedFillProcessing(exchangeOrder) {
    if (!exchangeOrder) {
      throw new Error("Exchange order is required");
    }

    const status = String(
      exchangeOrder.fill_processing_status ?? "",
    ).toUpperCase();

    if (status === "PROCESSED") {
      return {
        recovered: false,
        reason: "FILL_ALREADY_PROCESSED",
        exchangeOrder,
      };
    }

    if (status !== "EXHAUSTED") {
      return {
        recovered: false,
        reason: "FILL_PROCESSING_NOT_EXHAUSTED",
        exchangeOrder,
      };
    }

    const recoveredOrder =
      this.exchangeOrderRepository.recoverFillProcessing(
        exchangeOrder.id,
      );

    if (
      !recoveredOrder ||
      recoveredOrder.fill_processing_status !== "FAILED"
    ) {
      throw new Error(
        `Unable to recover fill processing for order ${exchangeOrder.id}`,
      );
    }

    return {
      recovered: true,
      reason: "FILL_PROCESSING_RECOVERED",
      exchangeOrder: recoveredOrder,
      processingStatus:
        recoveredOrder.fill_processing_status,
      processingAttempts:
        recoveredOrder.fill_processing_attempts,
      maxAttempts:
        this.maxFillProcessingAttempts,
    };
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

    const localOrderStatus = String(
      exchangeOrder.status ?? "",
    ).toUpperCase();

    if (
      fillProcessingStatus === "PROCESSED" &&
      localOrderStatus !== "PARTIALLY_FILLED"
    ) {
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

    if (!["PARTIALLY_FILLED", "FILLED"].includes(checked.status)) {
      return {
        ...checked,
        processed: false,
      };
    }

    const response = checked.response;

    const exchangeTrades = Array.isArray(response?.fills)
      ? response.fills
      : [];

    if (exchangeTrades.length === 0) {
      const executedQuantity = Number(
        response?.executedQty ??
        response?.cummulativeQuantity ??
        0,
      );

      if (!Number.isFinite(executedQuantity) || executedQuantity <= 0) {
        throw new Error("Filled quantity is invalid");
      }

      const existingFills =
        this.fillRepository.findByExchangeOrderId(
          exchangeOrder.id,
        );

      const alreadyRecordedQuantity =
        existingFills.reduce(
          (sum, fill) => sum + Number(fill.quantity),
          0,
        );

      const newQuantity =
        executedQuantity - alreadyRecordedQuantity;

      if (newQuantity <= 0) {
        exchangeTrades.length = 0;
      } else {
        const fallbackPrice = Number(
          response?.avgPrice ??
          response?.price ??
          exchangeOrder.price,
        );

        if (!Number.isFinite(fallbackPrice) || fallbackPrice <= 0) {
          throw new Error("Filled price is invalid");
        }

        exchangeTrades.push({
          tradeId:
            `${exchangeOrder.exchange_order_id}:cum:${executedQuantity}`,
          price: fallbackPrice,
          qty: newQuantity,
          commission: response?.commission ?? 0,
          commissionAsset: response?.commissionAsset ?? null,
        });
      }
    }

    const newFills = [];

    for (const trade of exchangeTrades) {
      const tradeId =
        trade?.tradeId ??
        trade?.trade_id ??
        trade?.id ??
        null;

      const quantity = Number(
        trade?.qty ??
        trade?.quantity ??
        0,
      );

      const price = Number(
        trade?.price ??
        response?.avgPrice ??
        response?.price ??
        exchangeOrder.price,
      );

      if (!Number.isFinite(quantity) || quantity <= 0) {
        continue;
      }

      if (!Number.isFinite(price) || price <= 0) {
        throw new Error("Fill price is invalid");
      }

      if (tradeId) {
        const existing =
          this.fillRepository.findByExchangeTradeId(tradeId);

        if (existing) {
          continue;
        }
      } else {
        const existingFills =
          this.fillRepository.findByExchangeOrderId(
            exchangeOrder.id,
          );

        const alreadyRecordedQuantity =
          existingFills.reduce(
            (sum, fill) => sum + Number(fill.quantity),
            0,
          );

        const executedQuantity = Number(
          response?.executedQty ??
          response?.cummulativeQuantity ??
          0,
        );

        if (
          executedQuantity <= alreadyRecordedQuantity + quantity
        ) {
          if (executedQuantity <= alreadyRecordedQuantity) {
            continue;
          }
        }
      }

      const created =
        this.fillRepository.createTradeFill({
          exchangeOrderId: exchangeOrder.id,
          exchangeTradeId: tradeId,
          symbol,
          side: exchangeOrder.side,
          price,
          quantity,
          commission: Number(trade?.commission ?? 0),
          commissionAsset:
            trade?.commissionAsset ?? null,
          filledAt:
            trade?.time ??
            response?.time ??
            response?.transactTime ??
            new Date().toISOString(),
          exchangeResponse: {
            order: response,
            trade,
          },
        });

      if (created.created) {
        newFills.push(created.fill);
      }
    }

    this.exchangeOrderRepository.updateStatus(
      exchangeOrder.id,
      checked.status,
    );

    if (newFills.length === 0) {
      return {
        ...checked,
        processed: false,
        reason: "NO_NEW_FILLS",
        fillCount: 0,
      };
    }

    const results = [];

    for (const fill of newFills) {
      const processed =
        await this.processExistingFill({
          exchangeOrder:
            this.exchangeOrderRepository.findById(
              exchangeOrder.id,
            ),
          symbol,
          fill,
          checked,
        });

      results.push(processed);
    }

    return {
      ...checked,
      processed: true,
      reason: "NEW_FILLS_PROCESSED",
      fillCount: newFills.length,
      fills: newFills,
      results,
    };

  }
}
