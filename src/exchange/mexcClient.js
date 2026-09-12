import crypto from "node:crypto";

export default class MexcClient {
  constructor({
    baseUrl = process.env.MEXC_BASE_URL,
    apiKey = process.env.MEXC_API_KEY,
    apiSecret = process.env.MEXC_API_SECRET,
    recvWindow = Number(process.env.MEXC_RECV_WINDOW || 5000),
  } = {}) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.recvWindow = recvWindow;

    if (!this.baseUrl) {
      throw new Error("MEXC base URL is required");
    }

    if (!Number.isInteger(this.recvWindow) || this.recvWindow <= 0 || this.recvWindow >= 60000) {
      throw new Error("MEXC recvWindow must be greater than 0 and less than 60000");
    }
  }

  buildQuery(params = {}) {
    return new URLSearchParams(
      Object.entries(params).filter(([, value]) => value !== undefined && value !== null),
    ).toString();
  }

  sign(payload) {
    if (!this.apiSecret) {
      throw new Error("MEXC API secret is required for signed requests");
    }

    return crypto
      .createHmac("sha256", this.apiSecret)
      .update(payload)
      .digest("hex");
  }

  async request(method, path, { params = {}, signed = false } = {}) {
    const requestParams = { ...params };

    if (signed) {
      requestParams.recvWindow = this.recvWindow;
      requestParams.timestamp = Date.now();
    }

    let query = this.buildQuery(requestParams);

    if (signed) {
      query += `${query ? "&" : ""}signature=${this.sign(query)}`;
    }

    const url = `${this.baseUrl}${path}${query ? `?${query}` : ""}`;

    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(this.apiKey ? { "X-MEXC-APIKEY": this.apiKey } : {}),
      },
    });

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`MEXC returned invalid JSON (${response.status}): ${text}`);
    }

    if (!response.ok) {
      throw new Error(
        `MEXC API HTTP ${response.status}: ${data.msg || text}`,
      );
    }

    if (data.code !== undefined && data.code !== 0) {
      throw new Error(
        `MEXC API error ${data.code}: ${data.msg || "Unknown error"}`,
      );
    }

    return data;
  }

  getExchangeInfo(symbol) {
    return this.request("GET", "/api/v3/exchangeInfo", {
      params: symbol ? { symbol } : {},
    });
  }

  getPrice(symbol) {
    return this.request("GET", "/api/v3/ticker/price", {
      params: { symbol },
    });
  }

  getBookTicker(symbol) {
    return this.request("GET", "/api/v3/ticker/bookTicker", {
      params: { symbol },
    });
  }

  getAccount() {
    return this.request("GET", "/api/v3/account", {
      signed: true,
    });
  }

  getOrder({ symbol, orderId, origClientOrderId }) {
    return this.request("GET", "/api/v3/order", {
      params: {
        symbol,
        orderId,
        origClientOrderId,
      },
      signed: true,
    });
  }

  getOpenOrders(symbol) {
    return this.request("GET", "/api/v3/openOrders", {
      params: { symbol },
      signed: true,
    });
  }

  createOrder(params) {
    return this.request("POST", "/api/v3/order", {
      params,
      signed: true,
    });
  }

  cancelOrder({ symbol, orderId, origClientOrderId }) {
    return this.request("DELETE", "/api/v3/order", {
      params: {
        symbol,
        orderId,
        origClientOrderId,
      },
      signed: true,
    });
  }
}
