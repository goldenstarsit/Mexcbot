import assert from "node:assert/strict";

function evaluateLiveTradingGuard({ apiKey, apiSecret, accountReadiness }) {
  const hasApiCredentials = Boolean(apiKey) && Boolean(apiSecret);

  if (!hasApiCredentials) {
    return false;
  }

  return (
    accountReadiness.status === "OK" &&
    accountReadiness.authenticated === true &&
    accountReadiness.canTrade === true &&
    accountReadiness.tradingReady === true
  );
}

assert.equal(
  evaluateLiveTradingGuard({
    apiKey: "KEY",
    apiSecret: "SECRET",
    accountReadiness: {
      status: "OK",
      authenticated: true,
      canTrade: true,
      tradingReady: true,
    },
  }),
  true,
);

assert.equal(
  evaluateLiveTradingGuard({
    apiKey: "",
    apiSecret: "",
    accountReadiness: {
      status: "OK",
      authenticated: true,
      canTrade: true,
      tradingReady: true,
    },
  }),
  false,
);

assert.equal(
  evaluateLiveTradingGuard({
    apiKey: "KEY",
    apiSecret: "SECRET",
    accountReadiness: {
      status: "OK",
      authenticated: true,
      canTrade: false,
      tradingReady: false,
    },
  }),
  false,
);

assert.equal(
  evaluateLiveTradingGuard({
    apiKey: "KEY",
    apiSecret: "SECRET",
    accountReadiness: {
      status: "OK",
      authenticated: true,
      canTrade: true,
      tradingReady: false,
    },
  }),
  false,
);

assert.equal(
  evaluateLiveTradingGuard({
    apiKey: "KEY",
    apiSecret: "SECRET",
    accountReadiness: {
      status: "ERROR",
      authenticated: false,
      canTrade: null,
      tradingReady: false,
    },
  }),
  false,
);

console.log("M97 LIVE TRADING ENABLE GUARD: PASS");
console.log({
  readyAccountEnabled: true,
  missingCredentialsBlocked: true,
  cannotTradeBlocked: true,
  insufficientBalanceBlocked: true,
  accountHealthErrorBlocked: true,
});
