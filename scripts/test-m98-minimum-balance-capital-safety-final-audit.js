import assert from "node:assert/strict";

import TradingCapitalGuard from "../src/services/tradingCapitalGuard.js";
import TradingCapitalReservationService from "../src/services/tradingCapitalReservationService.js";

const guard = new TradingCapitalGuard();

const exactMinimum = guard.canPlaceBuy("1", "1");
assert.equal(exactMinimum.allowed, true);

const belowMinimum = guard.canPlaceBuy("0.999999", "1");
assert.equal(belowMinimum.allowed, false);
assert.equal(belowMinimum.reason, "INSUFFICIENT_FREE_USDT");

const reservation = new TradingCapitalReservationService();

const first = reservation.reserve(1);
assert.equal(first.reserved, true);
assert.equal(reservation.getReservedUsdt(), 1);

const blocked = reservation.canReserve(1, 1);
assert.equal(blocked.allowed, false);
assert.equal(blocked.usableUsdt, 0);

const released = reservation.release(first);
assert.equal(released.released, true);
assert.equal(reservation.getReservedUsdt(), 0);

const duplicateRelease = reservation.release(first);
assert.equal(duplicateRelease.released, false);
assert.equal(reservation.getReservedUsdt(), 0);

const next = reservation.reserve(1);
assert.equal(next.reserved, true);
assert.equal(reservation.getReservedUsdt(), 1);

reservation.release(next);
assert.equal(reservation.getReservedUsdt(), 0);

console.log("M98 MINIMUM BALANCE / CAPITAL SAFETY FINAL AUDIT: PASS");
console.log({
  exactMinimumAllowed: exactMinimum.allowed,
  belowMinimumBlocked: !belowMinimum.allowed,
  reservedCapitalBlockedDuplicateUse: !blocked.allowed,
  releaseSuccessful: released.released,
  duplicateReleaseBlocked: !duplicateRelease.released,
  finalReservedUsdt: reservation.getReservedUsdt(),
});
