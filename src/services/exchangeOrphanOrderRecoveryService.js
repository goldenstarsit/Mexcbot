export default class ExchangeOrphanOrderRecoveryService {
  constructor({
    mexcClient,
    tradingConfig,
    exchangeOrderRepository,
    tradingCycleRepository,
    dcaOrderRepository,
  }) {
    if (!mexcClient) {
      throw new Error("MEXC client is required");
    }

    if (!tradingConfig?.symbols?.length) {
      throw new Error("Trading config symbols are required");
    }

    if (!exchangeOrderRepository) {
      throw new Error("Exchange order repository is required");
    }

    if (!tradingCycleRepository) {
      throw new Error("Trading cycle repository is required");
    }

    if (!dcaOrderRepository) {
      throw new Error("DCA order repository is required");
    }

    this.mexcClient = mexcClient;
    this.tradingConfig = tradingConfig;
    this.exchangeOrderRepository = exchangeOrderRepository;
    this.tradingCycleRepository = tradingCycleRepository;
    this.dcaOrderRepository = dcaOrderRepository;
  }

  normalizeClientOrderId(order) {
    return String(
      order?.origClientOrderId ??
      order?.clientOrderId ??
      order?.client_order_id ??
      "",
    );
  }

  normalizeExchangeOrderId(order) {
    return String(
      order?.orderId ??
      order?.order_id ??
      order?.id ??
      "",
    );
  }

  normalizeStatus(order) {
    return String(
      order?.status ??
      order?.orderStatus ??
      "NEW",
    ).toUpperCase();
  }

  resolveRelation(clientOrderId) {
    const match = /^mxc-c(\d+)-(initial|dca-(\d+)|tp|sl)$/.exec(
      clientOrderId,
    );

    if (!match) {
      return null;
    }

    const tradingCycleId = Number(match[1]);
    const purpose = match[2];

    const cycle =
      this.tradingCycleRepository.findById(
        tradingCycleId,
      );

    if (!cycle) {
      return null;
    }

    let dcaOrderId = null;

    if (purpose.startsWith("dca-")) {
      dcaOrderId = Number(match[3]);

      const dcaOrder =
        this.dcaOrderRepository.findById(
          dcaOrderId,
        );

      if (
        !dcaOrder ||
        Number(dcaOrder.trading_cycle_id) !==
          tradingCycleId
      ) {
        return null;
      }
    }

    return {
      tradingCycleId,
      dcaOrderId,
      cycle,
    };
  }

  async scanSymbol(symbol) {
    const response =
      await this.mexcClient.getOpenOrders(symbol);

    const orders = Array.isArray(response)
      ? response
      : Array.isArray(response?.data)
        ? response.data
        : [];

    const results = [];

    for (const remoteOrder of orders) {
      const exchangeOrderId =
        this.normalizeExchangeOrderId(remoteOrder);

      const clientOrderId =
        this.normalizeClientOrderId(remoteOrder);

      if (!exchangeOrderId) {
        results.push({
          status: "INVALID_REMOTE_ORDER",
          symbol,
        });
        continue;
      }

      const local =
        this.exchangeOrderRepository.findByExchangeOrderId(
          exchangeOrderId,
        );

      if (local) {
        results.push({
          status: "ALREADY_RECORDED",
          symbol,
          exchangeOrderId,
        });
        continue;
      }

      const relation =
        this.resolveRelation(clientOrderId);

      if (!relation) {
        results.push({
          status: "ORPHAN_UNRESOLVED",
          symbol,
          exchangeOrderId,
          clientOrderId,
        });
        continue;
      }

      const exchangeOrder =
        this.exchangeOrderRepository.create({
          tradingCycleId:
            relation.tradingCycleId,
          dcaOrderId:
            relation.dcaOrderId,
          symbol,
          exchangeOrderId,
          clientOrderId,
          side: String(
            remoteOrder.side ?? "",
          ).toUpperCase(),
          orderType: String(
            remoteOrder.type ??
            remoteOrder.orderType ??
            "LIMIT_MAKER",
          ).toUpperCase(),
          price: Number(remoteOrder.price),
          quantity: Number(
            remoteOrder.origQty ??
            remoteOrder.quantity,
          ),
          status:
            this.normalizeStatus(remoteOrder),
          placementResponse: remoteOrder,
        });

      results.push({
        status: "RECOVERED_ORPHAN",
        symbol,
        exchangeOrderId,
        clientOrderId,
        localExchangeOrderId:
          exchangeOrder.id,
      });
    }

    return {
      symbol,
      checked: orders.length,
      alreadyRecorded: results.filter(
        (result) =>
          result.status === "ALREADY_RECORDED",
      ).length,
      recovered: results.filter(
        (result) =>
          result.status === "RECOVERED_ORPHAN",
      ).length,
      unresolved: results.filter(
        (result) =>
          result.status === "ORPHAN_UNRESOLVED",
      ).length,
      invalid: results.filter(
        (result) =>
          result.status === "INVALID_REMOTE_ORDER",
      ).length,
      results,
    };
  }

  async recover() {
    const results = [];

    for (const symbol of this.tradingConfig.symbols) {
      try {
        results.push(
          await this.scanSymbol(symbol),
        );
      } catch (error) {
        results.push({
          symbol,
          status: "EXCHANGE_CHECK_FAILED",
          error: error.message,
        });
      }
    }

    return {
      checkedSymbols: results.length,
      checkedOrders: results.reduce(
        (sum, result) =>
          sum + Number(result.checked ?? 0),
        0,
      ),
      recovered: results.reduce(
        (sum, result) =>
          sum + Number(result.recovered ?? 0),
        0,
      ),
      unresolved: results.reduce(
        (sum, result) =>
          sum + Number(result.unresolved ?? 0),
        0,
      ),
      failedSymbols: results.filter(
        (result) =>
          result.status ===
          "EXCHANGE_CHECK_FAILED",
      ).length,
      results,
    };
  }
}
