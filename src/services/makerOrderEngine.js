export default class MakerOrderEngine {
  constructor(mexcClient, tradingConfig) {
    this.mexcClient = mexcClient;
    this.tradingConfig = tradingConfig;

    if (tradingConfig.order.type !== "LIMIT_MAKER") {
      throw new Error("Maker-only engine requires LIMIT_MAKER orders");
    }

    if (tradingConfig.order.makerOnly !== true) {
      throw new Error("Maker-only trading must be enabled");
    }
  }

  validateBuyPrice(price, bestAsk) {
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("BUY price must be greater than 0");
    }

    if (!Number.isFinite(bestAsk) || bestAsk <= 0) {
      throw new Error("Best ask must be greater than 0");
    }

    if (price >= bestAsk) {
      throw new Error(
        `BUY maker order would take liquidity: price ${price} >= bestAsk ${bestAsk}`,
      );
    }

    return true;
  }

  validateSellPrice(price, bestBid) {
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("SELL price must be greater than 0");
    }

    if (!Number.isFinite(bestBid) || bestBid <= 0) {
      throw new Error("Best bid must be greater than 0");
    }

    if (price <= bestBid) {
      throw new Error(
        `SELL maker order would take liquidity: price ${price} <= bestBid ${bestBid}`,
      );
    }

    return true;
  }

  async placeBuy({ symbol, quantity, price, bestAsk, clientOrderId }) {
    this.validateBuyPrice(price, bestAsk);

    return this.mexcClient.createOrder({
      symbol,
      side: "BUY",
      type: "LIMIT_MAKER",
      quantity,
      price,
      ...(clientOrderId ? { newClientOrderId: clientOrderId } : {}),
    });
  }

  async placeSell({ symbol, quantity, price, bestBid, clientOrderId }) {
    this.validateSellPrice(price, bestBid);

    return this.mexcClient.createOrder({
      symbol,
      side: "SELL",
      type: "LIMIT_MAKER",
      quantity,
      price,
      ...(clientOrderId ? { newClientOrderId: clientOrderId } : {}),
    });
  }
}
