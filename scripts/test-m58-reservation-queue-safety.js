import TradingCapitalReservationService from "../src/services/tradingCapitalReservationService.js";

const reservation = new TradingCapitalReservationService();

const order = [];

reservation.reserve(3);

const blockedLarge = reservation.acquire(3, 3, 1).then(() => {
  order.push("3-USDT");
  reservation.release(3);
});

const blockedSmall = reservation.acquire(3, 1, 2).then(() => {
  order.push("1-USDT");
  reservation.release(1);
});

await new Promise((resolve) => setImmediate(resolve));

if (order.length !== 0) {
  throw new Error("Requests must remain queued while capital is unavailable");
}

if (reservation.getReservedUsdt() !== 3) {
  throw new Error(
    `Expected 3 USDT reserved while blocked, got ${reservation.getReservedUsdt()}`,
  );
}

reservation.release(3);

await Promise.all([blockedLarge, blockedSmall]);

const expectedOrder = ["1-USDT", "3-USDT"];

if (JSON.stringify(order) !== JSON.stringify(expectedOrder)) {
  throw new Error(
    `Unexpected priority order: ${JSON.stringify(order)}`,
  );
}

if (reservation.getReservedUsdt() !== 0) {
  throw new Error(
    `Expected final reservation 0, got ${reservation.getReservedUsdt()}`,
  );
}

const negativeProtection = new TradingCapitalReservationService();

negativeProtection.reserve(1);
negativeProtection.release(5);

if (negativeProtection.getReservedUsdt() !== 0) {
  throw new Error("Reservation balance must never become negative");
}

console.log("M58 RESERVATION QUEUE SAFETY: PASS");
console.log({
  blockedRequestsQueued: true,
  priorityAfterRelease: order,
  finalReservedUsdt: reservation.getReservedUsdt(),
  negativeReservationProtected: true,
});
