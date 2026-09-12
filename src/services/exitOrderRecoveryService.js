export default class ExitOrderRecoveryService {
  constructor({
    tradingCycleRepository,
    exchangeOrderRepository,
    duplicateProtectionService,
  }) {
    this.tradingCycleRepository = tradingCycleRepository;
    this.exchangeOrderRepository = exchangeOrderRepository;
    this.duplicateProtectionService = duplicateProtectionService;
  }

  normalizeRemoteStatus(status) {
    const value = String(status ?? "").toUpperCase();

    if (value === "FILLED") {
      return "ORDER_PLACED";
    }

    if (
      ["NEW", "ORDER_PLACED", "PARTIALLY_FILLED"].includes(value)
    ) {
      return value;
    }

    if (
      ["CANCELED", "CANCELLED", "REJECTED", "EXPIRED"].includes(value)
    ) {
      return value;
    }

    return "ORDER_PLACED";
  }

  getRemoteField(response, ...names) {
    for (const name of names) {
      if (
        response?.[name] !== undefined &&
        response?.[name] !== null &&
        response?.[name] !== ""
      ) {
        return response[name];
      }
    }

    return null;
  }

  async findRemoteExit({ symbol, clientOrderId }) {
    return this.duplicateProtectionService.findExisting({
      symbol,
      clientOrderId,
    });
  }

  async recoverCycle(cycle) {
    const cycleId = Number(cycle.id);
    const symbol = cycle.symbol;

    const activeLocal =
      this.exchangeOrderRepository.findActiveSellByCycleId(cycleId);

    if (activeLocal) {
      return {
        cycleId,
        symbol,
        status: "LOCAL_EXIT_EXISTS",
        exchangeOrderId: activeLocal.exchange_order_id,
      };
    }

    const tpClientOrderId =
      this.duplicateProtectionService.createClientOrderId({
        cycleId,
        kind: "tp",
      });

    const slClientOrderId =
      this.duplicateProtectionService.createClientOrderId({
        cycleId,
        kind: "sl",
      });

    const [tp, sl] = await Promise.all([
      this.findRemoteExit({
        symbol,
        clientOrderId: tpClientOrderId,
      }),
      this.findRemoteExit({
        symbol,
        clientOrderId: slClientOrderId,
      }),
    ]);

    const remoteMatches = [
      tp?.source === "EXCHANGE" ? { kind: "tp", ...tp } : null,
      sl?.source === "EXCHANGE" ? { kind: "sl", ...sl } : null,
    ].filter(Boolean);

    if (remoteMatches.length > 1) {
      throw new Error(
        `Multiple remote exit orders found for cycle ${cycleId}`,
      );
    }

    if (remoteMatches.length === 0) {
      await this.tradingCycleRepository.updateStatus(
        cycleId,
        "OPEN",
      );

      return {
        cycleId,
        symbol,
        status: "RESET_TO_OPEN",
        reason: "NO_REMOTE_EXIT_FOUND",
      };
    }

    const match = remoteMatches[0];
    const response = match.response;

    const exchangeOrderId = String(
      this.getRemoteField(
        response,
        "orderId",
        "order_id",
        "id",
      ) ?? "",
    );

    if (!exchangeOrderId) {
      throw new Error(
        `Remote exit order ID is missing for cycle ${cycleId}`,
      );
    }

    const clientOrderId =
      this.getRemoteField(
        response,
        "clientOrderId",
        "client_order_id",
        "origClientOrderId",
      ) ?? (match.kind === "tp" ? tpClientOrderId : slClientOrderId);

    const side =
      String(
        this.getRemoteField(response, "side") ?? "SELL",
      ).toUpperCase();

    const orderType =
      this.getRemoteField(
        response,
        "type",
        "orderType",
        "order_type",
      ) ?? "LIMIT_MAKER";

    const price = Number(
      this.getRemoteField(response, "price") ?? 0,
    );

    const quantity = Number(
      this.getRemoteField(
        response,
        "origQty",
        "quantity",
        "qty",
      ) ?? 0,
    );

    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(
        `Remote exit price is invalid for cycle ${cycleId}`,
      );
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(
        `Remote exit quantity is invalid for cycle ${cycleId}`,
      );
    }

    const remoteStatus = String(
      this.getRemoteField(response, "status") ?? "NEW",
    ).toUpperCase();

    const localStatus = this.normalizeRemoteStatus(remoteStatus);

    const existingByExchangeId =
      this.exchangeOrderRepository.findByExchangeOrderId(
        exchangeOrderId,
      );

    if (existingByExchangeId) {
      return {
        cycleId,
        symbol,
        status: "LOCAL_ORDER_ALREADY_EXISTS",
        exchangeOrder: existingByExchangeId,
      };
    }

    const exchangeOrder =
      this.exchangeOrderRepository.create({
        tradingCycleId: cycleId,
        symbol,
        exchangeOrderId,
        clientOrderId,
        side,
        orderType,
        price,
        quantity,
        status: localStatus,
        placementResponse: response,
      });

    if (
      ["CANCELED", "CANCELLED", "REJECTED", "EXPIRED"].includes(
        localStatus,
      )
    ) {
      await this.tradingCycleRepository.updateStatus(
        cycleId,
        "OPEN",
      );
    }

    return {
      cycleId,
      symbol,
      status: "REMOTE_EXIT_RECOVERED",
      kind: match.kind,
      remoteStatus,
      localStatus,
      exchangeOrder,
    };
  }

  async recover() {
    const cycles =
      this.tradingCycleRepository.findByStatus("EXIT_PENDING");

    const results = [];

    for (const cycle of cycles) {
      try {
        results.push(await this.recoverCycle(cycle));
      } catch (error) {
        results.push({
          cycleId: cycle.id,
          symbol: cycle.symbol,
          status: "RECOVERY_FAILED",
          error: error.message,
        });

        console.error(
          `[ExitRecovery] Cycle ${cycle.id} failed:`,
          error.message,
        );
      }
    }

    return {
      checked: cycles.length,
      results,
    };
  }
}
