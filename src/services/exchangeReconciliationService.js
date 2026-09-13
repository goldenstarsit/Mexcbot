export default class ExchangeReconciliationService {
  constructor({
    mexcClient,
    exchangeOrderRepository,
  }) {
    this.mexcClient = mexcClient;
    this.exchangeOrderRepository = exchangeOrderRepository;
  }

  normalizeStatus(response) {
    return String(
      response?.status ??
      response?.orderStatus ??
      response?.data?.status ??
      "",
    ).toUpperCase();
  }

  async reconcileOrder(exchangeOrder) {
    const exchangeOrderId = String(
      exchangeOrder.exchange_order_id ?? "",
    );

    const symbol = String(
      exchangeOrder.symbol ?? "",
    );

    if (!exchangeOrderId || !symbol) {
      return {
        exchangeOrderId,
        symbol,
        status: "INVALID_LOCAL_ORDER",
        match: false,
      };
    }

    const response = await this.mexcClient.getOrder({
      symbol,
      orderId: exchangeOrderId,
    });

    const exchangeStatus = this.normalizeStatus(response);
    const localStatus = String(
      exchangeOrder.status ?? "",
    ).toUpperCase();

    this.exchangeOrderRepository.updateFinalResponse(
      exchangeOrder.id,
      response,
    );

    const statusMatches =
      exchangeStatus === localStatus ||
      (
        localStatus === "NEW" &&
        exchangeStatus === "NEW"
      ) ||
      (
        localStatus === "ORDER_PLACED" &&
        ["NEW", "ORDER_PLACED", "PARTIALLY_FILLED"].includes(
          exchangeStatus,
        )
      );

    return {
      exchangeOrderId,
      symbol,
      localStatus,
      exchangeStatus,
      match: statusMatches,
      status: statusMatches
        ? "CONSISTENT"
        : "DISCREPANCY",
      response,
    };
  }

  async reconcile() {
    const orders =
      this.exchangeOrderRepository.findActive();

    const results = [];

    for (const exchangeOrder of orders) {
      try {
        results.push(
          await this.reconcileOrder(exchangeOrder),
        );
      } catch (error) {
        results.push({
          exchangeOrderId:
            exchangeOrder.exchange_order_id,
          symbol: exchangeOrder.symbol,
          status: "EXCHANGE_CHECK_FAILED",
          match: false,
          error: error.message,
        });
      }
    }

    return {
      checked: orders.length,
      consistent: results.filter(
        (result) => result.status === "CONSISTENT",
      ).length,
      discrepancies: results.filter(
        (result) => result.status === "DISCREPANCY",
      ).length,
      failed: results.filter(
        (result) => result.status === "EXCHANGE_CHECK_FAILED",
      ).length,
      results,
    };
  }
}
