export default class CapitalReservationDashboardService {
  constructor({
    tradingCapitalReservationService,
    mexcAccountHealthService,
  }) {
    if (!tradingCapitalReservationService) {
      throw new Error("Trading capital reservation service is required");
    }

    if (!mexcAccountHealthService) {
      throw new Error("MEXC account health service is required");
    }

    this.tradingCapitalReservationService =
      tradingCapitalReservationService;
    this.mexcAccountHealthService =
      mexcAccountHealthService;
  }

  async getStatus() {
    const service = this.tradingCapitalReservationService;

    const reservedUsdt = Number(
      service.getReservedUsdt(),
    );

    const activeReservations = [...service.activeReservations.entries()]
      .map(([id, amount]) => ({
        id,
        amount: Number(amount),
      }));

    const pendingReservations =
      service.pendingReservations.map((request) => ({
        sequence: request.sequence,
        requiredUsdt: Number(request.requiredUsdt),
        availableUsdt: Number(request.availableUsdt),
        waitingMs: Math.max(
          0,
          Date.now() - (
            Number(request.createdAt ?? Date.now())
          ),
        ),
      }));

    const account = await this.mexcAccountHealthService.check();

    const freeUsdt = Number(account?.usdt?.free ?? 0);
    const lockedUsdt = Number(account?.usdt?.locked ?? 0);
    const usableUsdt = Math.max(
      0,
      freeUsdt - reservedUsdt,
    );

    return {
      status: "OK",
      account: {
        freeUsdt,
        lockedUsdt,
      },
      reservation: {
        reservedUsdt,
        usableUsdt,
        activeCount: activeReservations.length,
        pendingCount: pendingReservations.length,
        active: activeReservations,
        pending: pendingReservations,
      },
      checkedAt: new Date().toISOString(),
    };
  }
}
