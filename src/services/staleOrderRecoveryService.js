export default class StaleOrderRecoveryService {
  constructor({
    exchangeOrderRepository,
    cancelReplaceService,
    staleOrderAgeMs = 15 * 60 * 1000,
  }) {
    if (!exchangeOrderRepository) {
      throw new Error("Exchange order repository is required");
    }

    if (!cancelReplaceService) {
      throw new Error("Cancel replace service is required");
    }

    if (!Number.isInteger(staleOrderAgeMs) || staleOrderAgeMs <= 0) {
      throw new Error("Stale order age must be a positive integer");
    }

    this.exchangeOrderRepository = exchangeOrderRepository;
    this.cancelReplaceService = cancelReplaceService;
    this.staleOrderAgeMs = staleOrderAgeMs;
  }

  isActiveStatus(status) {
    return ["NEW", "PARTIALLY_FILLED"].includes(
      String(status ?? "").toUpperCase(),
    );
  }

  isStale(exchangeOrder, now = Date.now()) {
    const createdAt = Date.parse(exchangeOrder?.created_at ?? "");

    if (!Number.isFinite(createdAt)) {
      return false;
    }

    return now - createdAt >= this.staleOrderAgeMs;
  }

  async recover({ now = Date.now() } = {}) {
    const orders = this.exchangeOrderRepository.findActive();

    const results = [];

    for (const exchangeOrder of orders) {
      const status = String(
        exchangeOrder.status ?? "",
      ).toUpperCase();

      if (!this.isActiveStatus(status)) {
        continue;
      }

      if (!this.isStale(exchangeOrder, now)) {
        continue;
      }

      try {
        const result = await this.cancelReplaceService.cancel({
          exchangeOrderId: exchangeOrder.exchange_order_id,
          symbol: exchangeOrder.symbol,
          clientOrderId: exchangeOrder.client_order_id,
        });

        results.push({
          orderId: exchangeOrder.id,
          exchangeOrderId: exchangeOrder.exchange_order_id,
          status,
          recovered: true,
          reason: result.reason,
        });
      } catch (error) {
        results.push({
          orderId: exchangeOrder.id,
          exchangeOrderId: exchangeOrder.exchange_order_id,
          status,
          recovered: false,
          reason: "STALE_ORDER_RECOVERY_FAILED",
          error: error?.message ?? String(error),
        });
      }
    }

    return {
      checked: orders.length,
      stale: results.length,
      recovered: results.filter((item) => item.recovered).length,
      failed: results.filter((item) => !item.recovered).length,
      results,
    };
  }
}
