import MexcAccountHealthService from "../src/services/mexcAccountHealthService.js";

const mockClient = {
  async getAccount() {
    return {
      accountType: "SPOT",
      canTrade: true,
      canWithdraw: true,
      canDeposit: true,
      balances: [
        { asset: "USDT", free: "25.50", locked: "2.00" },
        { asset: "BTC", free: "0.001", locked: "0" },
        { asset: "ETH", free: "0", locked: "0" },
      ],
    };
  },
};

const service = new MexcAccountHealthService({
  mexcClient: mockClient,
});

const originalKey = process.env.MEXC_API_KEY;
const originalSecret = process.env.MEXC_API_SECRET;

process.env.MEXC_API_KEY = "M53_TEST_KEY";
process.env.MEXC_API_SECRET = "M53_TEST_SECRET";

try {
  const result = await service.check();

  if (result.status !== "OK") {
    throw new Error(`Unexpected status: ${result.status}`);
  }

  if (!result.authenticated) {
    throw new Error("Account should be authenticated");
  }

  if (result.canTrade !== true) {
    throw new Error("Account should be trade-enabled");
  }

  if (result.usdt?.free !== "25.50") {
    throw new Error(`Unexpected USDT free balance: ${result.usdt?.free}`);
  }

  if (result.usdt?.locked !== "2.00") {
    throw new Error(`Unexpected USDT locked balance: ${result.usdt?.locked}`);
  }

  if (result.tradingReady !== true) {
    throw new Error("Account should be trading ready");
  }

  console.log("M53 ACCOUNT READINESS: PASS");
  console.log({
    status: result.status,
    authenticated: result.authenticated,
    canTrade: result.canTrade,
    usdtFree: result.usdt.free,
    usdtLocked: result.usdt.locked,
    tradingReady: result.tradingReady,
  });
} finally {
  if (originalKey === undefined) {
    delete process.env.MEXC_API_KEY;
  } else {
    process.env.MEXC_API_KEY = originalKey;
  }

  if (originalSecret === undefined) {
    delete process.env.MEXC_API_SECRET;
  } else {
    process.env.MEXC_API_SECRET = originalSecret;
  }
}

const disabledService = new MexcAccountHealthService({
  mexcClient: mockClient,
});

delete process.env.MEXC_API_KEY;
delete process.env.MEXC_API_SECRET;

const disabledResult = await disabledService.check();

if (disabledResult.status !== "DISABLED") {
  throw new Error(`Unexpected disabled status: ${disabledResult.status}`);
}

if (disabledResult.usdt?.free !== "0") {
  throw new Error(`Unexpected disabled USDT free: ${disabledResult.usdt?.free}`);
}

if (disabledResult.tradingReady !== false) {
  throw new Error("Disabled account must not be trading ready");
}

console.log("M53 DISABLED ACCOUNT SAFETY: PASS");
