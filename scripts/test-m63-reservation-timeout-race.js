import TradingCapitalReservationService from "../src/services/tradingCapitalReservationService.js";

const ITERATIONS = 100;
let timeoutCount = 0;
let successCount = 0;

for (let i = 0; i < ITERATIONS; i += 1) {
  const reservation = new TradingCapitalReservationService({
    acquisitionTimeoutMs: 5,
  });

  const promise = reservation.acquire(2, 1, i);

  let settlements = 0;

  promise.then(
    () => {
      settlements += 1;
    },
    () => {
      settlements += 1;
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 5));

  const result = await promise.then(
    () => "SUCCESS",
    (error) => error.message,
  );

  await new Promise((resolve) => setImmediate(resolve));

  if (settlements !== 1) {
    throw new Error(
      `Iteration ${i}: acquisition settled ${settlements} times`,
    );
  }

  if (result === "SUCCESS") {
    successCount += 1;

    if (reservation.getReservedUsdt() !== 1) {
      throw new Error(
        `Iteration ${i}: successful acquisition has invalid reservation`,
      );
    }

    const activeIds = [...reservation.activeReservations.keys()];

    if (activeIds.length !== 1) {
      throw new Error(
        `Iteration ${i}: expected exactly one active reservation`,
      );
    }

    reservation.release(activeIds[0]);
  } else if (result === "Reservation acquisition timed out") {
    timeoutCount += 1;

    if (reservation.getReservedUsdt() !== 0) {
      throw new Error(
        `Iteration ${i}: timed-out acquisition leaked reservation`,
      );
    }
  } else {
    throw new Error(
      `Iteration ${i}: unexpected result: ${result}`,
    );
  }

  if (reservation.pendingReservations.length !== 0) {
    throw new Error(
      `Iteration ${i}: pending reservation remained after settlement`,
    );
  }

  if (reservation.getReservedUsdt() !== 0) {
    throw new Error(
      `Iteration ${i}: final reservation balance is not zero`,
    );
  }
}

console.log("M63 RESERVATION TIMEOUT RACE SAFETY: PASS");
console.log({
  iterations: ITERATIONS,
  timeoutCount,
  successCount,
  singleSettlement: true,
  noPendingReservations: true,
  noReservationLeak: true,
  finalReservedUsdt: 0,
});
