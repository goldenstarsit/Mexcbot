export default class ErrorRecoveryDashboardService {
  constructor({
    exchangeOrderRepository,
    tradingCycleRepository,
  }) {
    if (!exchangeOrderRepository) {
      throw new Error("Exchange order repository is required");
    }

    if (!tradingCycleRepository) {
      throw new Error("Trading cycle repository is required");
    }

    this.exchangeOrderRepository = exchangeOrderRepository;
    this.tradingCycleRepository = tradingCycleRepository;
  }

  getStatus({ symbol = null } = {}) {
    const allOrders = this.exchangeOrderRepository.findActive();
    const terminalOrders =
      this.exchangeOrderRepository.findTerminalOrders();
    const recoverableOrders =
      this.exchangeOrderRepository.findRecoverableTerminalOrders();

    const filter = (order) =>
      !symbol || String(order.symbol).toUpperCase() === symbol.toUpperCase();

    const active = allOrders.filter(filter);
    const terminal = terminalOrders.filter(filter);
    const recoverable = recoverableOrders.filter(filter);

    const fillProcessingFailed = active.filter(
      (order) =>
        String(order.fill_processing_status ?? "").toUpperCase() ===
        "FAILED",
    );

    const recoveryFailed = terminal.filter(
      (order) =>
        String(order.recovery_status ?? "").toUpperCase() === "FAILED",
    );

    const recoveryExhausted = terminal.filter(
      (order) =>
        String(order.recovery_status ?? "").toUpperCase() === "EXHAUSTED",
    );

    const processing = terminal.filter(
      (order) =>
        String(order.recovery_status ?? "").toUpperCase() === "PROCESSING",
    );

    const cycles = symbol
      ? [
          this.tradingCycleRepository.findOpenBySymbol(symbol),
        ].filter(Boolean)
      : this.tradingCycleRepository.findByStatus("OPEN");

    const errors = [
      ...fillProcessingFailed.map((order) => ({
        source: "FILL_PROCESSING",
        severity: "ERROR",
        orderId: order.id,
        symbol: order.symbol,
        message:
          order.fill_processing_error ?? "Fill processing failed",
        attempts: Number(order.fill_processing_attempts ?? 0),
        createdAt: order.created_at,
        updatedAt: order.updated_at,
      })),
      ...recoveryFailed.map((order) => ({
        source: "ORDER_RECOVERY",
        severity: "ERROR",
        orderId: order.id,
        symbol: order.symbol,
        message:
          order.recovery_error ?? "Order recovery failed",
        attempts: Number(order.recovery_attempts ?? 0),
        createdAt: order.created_at,
        updatedAt: order.updated_at,
      })),
      ...recoveryExhausted.map((order) => ({
        source: "ORDER_RECOVERY",
        severity: "CRITICAL",
        orderId: order.id,
        symbol: order.symbol,
        message:
          order.recovery_error ?? "Recovery attempts exhausted",
        attempts: Number(order.recovery_attempts ?? 0),
        createdAt: order.created_at,
        updatedAt: order.updated_at,
      })),
    ].sort((a, b) =>
      String(b.updatedAt ?? b.createdAt ?? "").localeCompare(
        String(a.updatedAt ?? a.createdAt ?? ""),
      ),
    );

    return {
      status: "OK",
      summary: {
        openCycles: cycles.length,
        activeOrders: active.length,
        terminalOrders: terminal.length,
        recoverableOrders: recoverable.length,
        fillProcessingFailed: fillProcessingFailed.length,
        recoveryFailed: recoveryFailed.length,
        recoveryExhausted: recoveryExhausted.length,
        recoveryProcessing: processing.length,
        errorCount: errors.length,
        criticalCount: errors.filter(
          (error) => error.severity === "CRITICAL",
        ).length,
      },
      queues: {
        recoverable: recoverable.map((order) => ({
          id: order.id,
          symbol: order.symbol,
          side: order.side,
          status: order.status,
          recoveryStatus: order.recovery_status,
          attempts: Number(order.recovery_attempts ?? 0),
          error: order.recovery_error ?? null,
          exchangeOrderId: order.exchange_order_id,
          clientOrderId: order.client_order_id,
        })),
        fillProcessing: fillProcessingFailed.map((order) => ({
          id: order.id,
          symbol: order.symbol,
          side: order.side,
          status: order.status,
          attempts: Number(order.fill_processing_attempts ?? 0),
          error: order.fill_processing_error ?? null,
          exchangeOrderId: order.exchange_order_id,
          clientOrderId: order.client_order_id,
        })),
      },
      errors,
      checkedAt: new Date().toISOString(),
      filters: {
        symbol,
      },
    };
  }
}
