import TradingCapitalReservationService from "../src/services/tradingCapitalReservationService.js";

const reservation = new TradingCapitalReservationService();

const held = reservation.reserve(3);

let cancelledError = null;

const queued = reservation.acquire(3, 2, 1);

if (typeof queued.cancel !== "function") {
  throw new Error("Acquisition must expose cancel()");
}

if (!queued.cancel()) {
  throw new Error("Queued acquisition should be cancellable");
}

try {
  await queued;
} catch (error) {
  cancelledError = error;
}

if (!cancelledError || cancelledError.message !== "Reservation acquisition cancelled") {
  throw new Error("Cancelled acquisition must reject with cancellation error");
}

if (reservation.pendingReservations.length !== 0) {
  throw new Error("Cancelled acquisition must leave no pending request");
}

if (reservation.getReservedUsdt() !== 3) {
  throw new Error("Cancellation must not alter active reservations");
}

reservation.release(held);

if (reservation.getReservedUsdt() !== 0) {
  throw new Error("Active reservation must still release normally");
}

const available = await reservation.acquire(3, 2, 2);

if (!available.reserved || available.amount !== 2) {
  throw new Error("A later acquisition must succeed after cancellation");
}

reservation.release(available);

if (reservation.getReservedUsdt() !== 0) {
  throw new Error("Final reservation balance must be zero");
}

console.log("M60 RESERVATION CANCELLATION: PASS");
console.log({
  cancelAvailable: true,
  cancelledPendingRequest: true,
  activeReservationPreserved: true,
  laterAcquisitionSucceeded: true,
  finalReservedUsdt: reservation.getReservedUsdt(),
});
