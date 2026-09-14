import TradingCapitalGuard from "../src/services/tradingCapitalGuard.js";

const guard = new TradingCapitalGuard();

const exact = guard.canPlaceBuy("1.00");
if (!exact.allowed) {
  throw new Error("Exactly 1 USDT should be allowed");
}

const sufficient = guard.canPlaceBuy("5.00", "2.50");
if (!sufficient.allowed) {
  throw new Error("Sufficient USDT balance should be allowed");
}

const insufficient = guard.canPlaceBuy("0.99");
if (insufficient.allowed) {
  throw new Error("0.99 USDT should be rejected");
}

if (insufficient.reason !== "INSUFFICIENT_FREE_USDT") {
  throw new Error("Unexpected insufficient-balance reason");
}

if (Math.abs(insufficient.shortfallUsdt - 0.01) > 1e-9) {
  throw new Error(`Unexpected shortfall: ${insufficient.shortfallUsdt}`);
}

const requiredInsufficient = guard.canPlaceBuy("2.49", "2.50");
if (requiredInsufficient.allowed) {
  throw new Error("Balance below required amount should be rejected");
}

console.log("M54 TRADING CAPITAL GUARD: PASS");
console.log({
  exactMinimum: exact,
  sufficientBalance: sufficient,
  insufficientBalance: insufficient,
  requiredAmountInsufficient: requiredInsufficient,
});
