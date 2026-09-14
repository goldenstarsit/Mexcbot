import TradingCapitalReservationService from "../src/services/tradingCapitalReservationService.js";

const reservation = new TradingCapitalReservationService();

const first = reservation.canReserve(5, 3);

if (!first.allowed) {
  throw new Error("First reservation should be allowed");
}

const firstReservation = reservation.reserve(3);

const concurrent = reservation.canReserve(5, 3);

if (concurrent.allowed) {
  throw new Error("Concurrent reservation should be blocked");
}

if (concurrent.usableUsdt !== 2) {
  throw new Error(
    `Expected usable USDT 2, got ${concurrent.usableUsdt}`,
  );
}

reservation.release(firstReservation);

const afterRelease = reservation.canReserve(5, 3);

if (!afterRelease.allowed) {
  throw new Error("Reservation should be allowed after release");
}

console.log("M55 CAPITAL RESERVATION: PASS");
console.log({
  firstAllowed: first.allowed,
  concurrentBlocked: !concurrent.allowed,
  usableDuringReservation: concurrent.usableUsdt,
  reservedAfterRelease: reservation.getReservedUsdt(),
});
