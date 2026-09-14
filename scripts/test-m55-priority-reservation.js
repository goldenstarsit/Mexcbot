import TradingCapitalReservationService from "../src/services/tradingCapitalReservationService.js";

const reservation = new TradingCapitalReservationService();

const order = [];

const high = reservation.acquire(5, 3).then((result) => {
  order.push("3-USDT");
  reservation.release(result);
});

const low = reservation.acquire(5, 1).then((result) => {
  order.push("1-USDT");
  reservation.release(result);
});

const equalFirst = reservation.acquire(5, 2).then((result) => {
  order.push("2-USDT-FIRST");
  reservation.release(result);
});

const equalSecond = reservation.acquire(5, 2).then((result) => {
  order.push("2-USDT-SECOND");
  reservation.release(result);
});

await Promise.all([
  high,
  low,
  equalFirst,
  equalSecond,
]);

const expected = [
  "1-USDT",
  "2-USDT-FIRST",
  "2-USDT-SECOND",
  "3-USDT",
];

if (JSON.stringify(order) !== JSON.stringify(expected)) {
  throw new Error(
    `Priority order mismatch: ${JSON.stringify(order)}`,
  );
}

if (reservation.getReservedUsdt() !== 0) {
  throw new Error(
    `Expected final reservation 0, got ${reservation.getReservedUsdt()}`,
  );
}

console.log("M55 PRIORITY RESERVATION: PASS");
console.log({
  priorityOrder: order,
  finalReservedUsdt: reservation.getReservedUsdt(),
});
