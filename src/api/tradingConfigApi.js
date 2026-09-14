import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "public",
);

export default class TradingConfigApi {
  constructor({
    tradingConfigService,
    tradingCycleRepository,
    host = "127.0.0.1",
    port = 3000,
  }) {
    if (!tradingConfigService) {
      throw new Error("Trading config service is required");
    }

    if (tradingCycleRepository !== undefined) {
      this.tradingCycleRepository = tradingCycleRepository;
    }

    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error("Valid API port is required");
    }

    this.tradingConfigService = tradingConfigService;
    this.tradingCycleRepository = tradingCycleRepository;
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

    if (
      request.method === "GET" &&
      (url.pathname === "/" ||
        url.pathname === "/config" ||
        url.pathname === "/cycles" ||
        url.pathname === "/history")
    ) {
      const fileName =
        url.pathname === "/cycles" ||
        url.pathname === "/history"
          ? "cycles.html"
          : "config.html";

      const filePath = path.join(
        PUBLIC_DIR,
        fileName,
      );

      const body = fs.readFileSync(filePath);

      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": body.length,
      });

      response.end(body);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/config") {
      this.sendJson(
        response,
        200,
        this.tradingConfigService.getCurrent(),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/cycles") {
      if (!this.tradingCycleRepository) {
        this.sendJson(response, 500, {
          error: "Trading cycle repository is not configured",
        });
        return;
      }

      const limit = url.searchParams.get("limit") ?? 50;
      const offset = url.searchParams.get("offset") ?? 0;
      const symbol = url.searchParams.get("symbol");
      const status = url.searchParams.get("status");

      const cycles =
        this.tradingCycleRepository.listPerformanceHistory({
          symbol,
          status,
          limit,
          offset,
        });

      this.sendJson(response, 200, {
        cycles,
        limit: Math.min(
          Math.max(Number.parseInt(limit, 10) || 50, 1),
          100,
        ),
        offset: Math.max(
          Number.parseInt(offset, 10) || 0,
          0,
        ),
      });

      return;
    }

    const cycleMatch =
      url.pathname.match(/^\/api\/cycles\/(\d+)$/);

    if (request.method === "GET" && cycleMatch) {
      if (!this.tradingCycleRepository) {
        this.sendJson(response, 500, {
          error: "Trading cycle repository is not configured",
        });
        return;
      }

      const cycleId = Number(cycleMatch[1]);

      const cycle =
        this.tradingCycleRepository.findPerformanceById(
          cycleId,
        );

      if (!cycle) {
        this.sendJson(response, 404, {
          error: "Cycle not found",
        });
        return;
      }

      this.sendJson(response, 200, {
        cycle,
      });

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
