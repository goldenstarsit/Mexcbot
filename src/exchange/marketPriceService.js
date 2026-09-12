export default class MarketPriceService {
  constructor(mexcClient) {
    this.mexcClient = mexcClient;
  }

  async get(symbol) {
    const [priceData, bookData] = await Promise.all([
      this.mexcClient.getPrice(symbol),
      this.mexcClient.getBookTicker(symbol),
    ]);

    const price = Number(priceData.price);
    const bidPrice = Number(bookData.bidPrice);
    const askPrice = Number(bookData.askPrice);

    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Invalid market price for ${symbol}`);
    }

    if (!Number.isFinite(bidPrice) || bidPrice <= 0) {
      throw new Error(`Invalid best bid for ${symbol}`);
    }

    if (!Number.isFinite(askPrice) || askPrice <= 0) {
      throw new Error(`Invalid best ask for ${symbol}`);
    }

    return {
      symbol,
      price,
      bidPrice,
      askPrice,
      spread: askPrice - bidPrice,
      spreadPercent: ((askPrice - bidPrice) / bidPrice) * 100,
      timestamp: Date.now(),
    };
  }
}
