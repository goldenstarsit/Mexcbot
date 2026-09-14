import TradingCapitalReservationService from "../src/services/tradingCapitalReservationService.js";

const reservation = new TradingCapitalReservationService();

const first = reservation.reserve(2);
const second = reservation.reserve(3);

if (reservation.getReservedUsdt() !== 5) {
  throw new Error("Expected 5 USDT reserved");
}

// Releasing one 2-USDT reservation should leave the other 3-USDT
// reservation completely intact.
reservation.release(first);

if (reservation.getReservedUsdt() !== 3) {
  throw new Error(
    `Expected 3 USDT after first release, got ${reservation.getReservedUsdt()}`,
  );
}

// A stale/duplicate release of the same 2-USDT reservation must NOT
// consume the unrelated active 3-USDT reservation.
reservation.release(first);

if (reservation.getReservedUsdt() !== 3) {
  throw new Error(
    `STALE RELEASE BUG: expected 3 USDT, got ${reservation.getReservedUsdt()}`,
  );
}

console.log("M59 RESERVATION RELEASE SAFETY: PASS");
console.log({
  initialReservedUsdt: 5,
  afterFirstRelease: 3,
  afterDuplicateRelease: reservation.getReservedUsdt(),
  activeSecondReservation: second.id,
});
