import http from "node:http";

export default class TradingConfigApi {
  constructor({
    tradingConfigService,
    host = "127.0.0.1",
    port = 3000,
  }) {
    if (!tradingConfigService) {
      throw new Error("Trading config service is required");
    }

    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error("Valid API port is required");
    }

    this.tradingConfigService = tradingConfigService;
    this.host = host;
    this.port = port;
    this.server = null;
  }

  sendJson(response, statusCode, payload) {
    const body = JSON.stringify(payload);

    response.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
    });

    response.end(body);
  }

  async readJson(request) {
    const chunks = [];

    for await (const chunk of request) {
      chunks.push(chunk);
    }

    const body = Buffer.concat(chunks).toString("utf8");

    if (!body.trim()) {
      throw new Error("Request body is required");
    }

    try {
      return JSON.parse(body);
    } catch {
      throw new Error("Invalid JSON");
    }
  }

  async handle(request, response) {
    const url = new URL(
      request.url ?? "/",
      `http://${this.host}:${this.port}`,
    );

    if (request.method === "GET" && url.pathname === "/api/config") {
      this.sendJson(
        response,
        200,
        this.tradingConfigService.getCurrent(),
      );
      return;
    }

    if (request.method === "PUT" && url.pathname === "/api/config") {
      try {
        const config = await this.readJson(request);
        const updated =
          this.tradingConfigService.update(config);

        this.sendJson(response, 200, updated);
      } catch (error) {
        this.sendJson(response, 400, {
          error: error.message,
        });
      }

      return;
    }

    this.sendJson(response, 404, {
      error: "Not found",
    });
  }

  start() {
    if (this.server) {
      return false;
    }

    this.server = http.createServer((request, response) => {
      void this.handle(request, response).catch((error) => {
        this.sendJson(response, 500, {
          error: error.message,
        });
      });
    });

    this.server.listen(this.port, this.host);

    return true;
  }

  async stop() {
    if (!this.server) {
      return false;
    }

    const server = this.server;
    this.server = null;

    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    return true;
  }

  isRunning() {
    return Boolean(this.server);
  }
}
