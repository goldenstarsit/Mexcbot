export default class CompleteMonitoringDashboardService {
  constructor({
    botStatusService,
    exchangeOrderRepository,
    openPositionDashboardService,
    dcaProgressDashboardService,
    tpSlStatusDashboardService,
    capitalReservationDashboardService,
    errorRecoveryDashboardService,
  }) {
    if (!botStatusService) {
      throw new Error("Bot status service is required");
    }
    if (!exchangeOrderRepository) {
      throw new Error("Exchange order repository is required");
    }
    if (!openPositionDashboardService) {
      throw new Error("Open position dashboard service is required");
    }
    if (!dcaProgressDashboardService) {
      throw new Error("DCA progress dashboard service is required");
    }
    if (!tpSlStatusDashboardService) {
      throw new Error("TP/SL status dashboard service is required");
    }
    if (!capitalReservationDashboardService) {
      throw new Error("Capital reservation dashboard service is required");
    }
    if (!errorRecoveryDashboardService) {
      throw new Error("Error recovery dashboard service is required");
    }

    this.botStatusService = botStatusService;
    this.exchangeOrderRepository = exchangeOrderRepository;
    this.openPositionDashboardService =
      openPositionDashboardService;
    this.dcaProgressDashboardService =
      dcaProgressDashboardService;
    this.tpSlStatusDashboardService =
      tpSlStatusDashboardService;
    this.capitalReservationDashboardService =
      capitalReservationDashboardService;
    this.errorRecoveryDashboardService =
      errorRecoveryDashboardService;
  }

  async getStatus({ symbol = null } = {}) {
    const [
      runtime,
      positions,
      dca,
      tpSl,
      capital,
      errors,
    ] = await Promise.all([
      this.botStatusService.getStatus(),
      Promise.resolve(
        this.openPositionDashboardService.getOpenPositions({
          symbol,
        }),
      ),
      this.dcaProgressDashboardService.getProgress({
        symbol,
      }),
      Promise.resolve(
        this.tpSlStatusDashboardService.getStatus({
          symbol,
        }),
      ),
      this.capitalReservationDashboardService.getStatus(),
      Promise.resolve(
        this.errorRecoveryDashboardService.getStatus({
          symbol,
        }),
      ),
    ]);

    const liveOrders =
      this.exchangeOrderRepository.findLiveOrders({
        symbol,
        status: null,
        limit: 100,
        offset: 0,
      });

    const summary = {
      openCycles: positions.length,
      liveOrders: liveOrders.length,
      positions: positions.length,
      dcaCycles: dca.length,
      tpSlCycles: tpSl.length,
      reservedUsdt: Number(
        capital?.reservation?.reservedUsdt ?? 0,
      ),
      usableUsdt: Number(
        capital?.reservation?.usableUsdt ?? 0,
      ),
      errors: Number(
        errors?.summary?.errorCount ?? 0,
      ),
      criticalErrors: Number(
        errors?.summary?.criticalCount ?? 0,
      ),
      recoverableOrders: Number(
        errors?.summary?.recoverableOrders ?? 0,
      ),
    };

    return {
      status: "OK",
      checkedAt: new Date().toISOString(),
      filters: {
        symbol,
      },
      summary,
      runtime,
      liveOrders: {
        count: liveOrders.length,
        orders: liveOrders,
      },
      positions,
      dca,
      tpSl,
      capital,
      errors,
    };
  }
}
