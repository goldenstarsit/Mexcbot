import TradingCapitalReservationService from "../src/services/tradingCapitalReservationService.js";

const reservation = new TradingCapitalReservationService({
  acquisitionTimeoutMs: 25,
});

const held = reservation.reserve(3);

let timeoutError = null;

const queued = reservation.acquire(3, 2, 1);

try {
  await queued;
} catch (error) {
  timeoutError = error;
}

if (!timeoutError) {
  throw new Error("Queued acquisition must time out");
}

if (timeoutError.message !== "Reservation acquisition timed out") {
  throw new Error(
    `Unexpected timeout error: ${timeoutError.message}`,
  );
}

if (reservation.pendingReservations.length !== 0) {
  throw new Error("Timed-out acquisition must leave no pending request");
}

if (reservation.getReservedUsdt() !== 3) {
  throw new Error(
    "Timed-out acquisition must not alter active reservations",
  );
}

reservation.release(held);

if (reservation.getReservedUsdt() !== 0) {
  throw new Error("Held reservation must release normally");
}

const successful = await reservation.acquire(3, 2, 2);

if (!successful.reserved || successful.amount !== 2) {
  throw new Error("Later acquisition must succeed after timeout");
}

reservation.release(successful);

if (reservation.getReservedUsdt() !== 0) {
  throw new Error("Final reservation balance must be zero");
}

console.log("M61 RESERVATION ACQUISITION TIMEOUT: PASS");
console.log({
  timeoutConfiguredMs: 25,
  timeoutRejected: true,
  pendingAfterTimeout: reservation.pendingReservations.length,
  activeReservationPreserved: true,
  laterAcquisitionSucceeded: true,
  finalReservedUsdt: reservation.getReservedUsdt(),
});
