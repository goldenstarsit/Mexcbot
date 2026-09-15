import assert from "node:assert/strict";
import TradingCapitalReservationService from "../src/services/tradingCapitalReservationService.js";
import CapitalReservationDashboardService from "../src/services/capitalReservationDashboardService.js";

const reservation = new TradingCapitalReservationService();

const account = {
  async check() {
    return {
      status: "OK",
      usdt: {
        free: "10",
        locked: "2",
      },
    };
  },
};

const service = new CapitalReservationDashboardService({
  tradingCapitalReservationService: reservation,
  mexcAccountHealthService: account,
});

const first = reservation.reserve(3);
const second = reservation.reserve(2);

const status = await service.getStatus();

assert.equal(status.account.freeUsdt, 10);
assert.equal(status.account.lockedUsdt, 2);
assert.equal(status.reservation.reservedUsdt, 5);
assert.equal(status.reservation.usableUsdt, 5);
assert.equal(status.reservation.activeCount, 2);
assert.equal(status.reservation.pendingCount, 0);
assert.equal(status.reservation.active.length, 2);

reservation.release(first);
reservation.release(second);

const afterRelease = await service.getStatus();

assert.equal(afterRelease.reservation.reservedUsdt, 0);
assert.equal(afterRelease.reservation.usableUsdt, 10);

console.log("M105 CAPITAL RESERVATION DASHBOARD: PASS");
console.log({
  accountBalance: true,
  reservedCapital: true,
  usableCapital: true,
  activeReservations: true,
  pendingReservations: true,
  releaseLifecycle: true,
});
