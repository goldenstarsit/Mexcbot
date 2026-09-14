export default class MexcAccountHealthService {
  constructor({ mexcClient }) {
    if (!mexcClient) {
      throw new Error("MEXC client is required");
    }

    this.mexcClient = mexcClient;
  }

  async check() {
    const hasCredentials =
      Boolean(process.env.MEXC_API_KEY) &&
      Boolean(process.env.MEXC_API_SECRET);

    if (!hasCredentials) {
      return {
        status: "DISABLED",
        connected: false,
        authenticated: false,
        usdt: {
          free: "0",
          locked: "0",
        },
        tradingReady: false,
        reason: "MEXC API credentials are not configured",
        checkedAt: new Date().toISOString(),
      };
    }

    const startedAt = Date.now();

    try {
      const response =
        await this.mexcClient.getAccount();

      const balances = Array.isArray(response.balances)
        ? response.balances
        : [];

      const nonZeroBalances = balances
        .filter((balance) =>
          Number(balance.free ?? 0) > 0 ||
          Number(balance.locked ?? 0) > 0
        )
        .map((balance) => ({
          asset: balance.asset,
          free: balance.free,
          locked: balance.locked,
        }));

      const usdtBalance =
        balances.find((balance) => balance.asset === "USDT") ?? null;

      const usdt = usdtBalance
        ? {
            free: usdtBalance.free ?? "0",
            locked: usdtBalance.locked ?? "0",
          }
        : {
            free: "0",
            locked: "0",
          };

      const tradingReady =
        response.canTrade === true &&
        Number(usdt.free) >= 1;

      return {
        status: "OK",
        connected: true,
        authenticated: true,
        accountType: response.accountType ?? null,
        canTrade: response.canTrade ?? null,
        canWithdraw: response.canWithdraw ?? null,
        canDeposit: response.canDeposit ?? null,
        usdt,
        tradingReady,
        nonZeroBalances,
        balanceCount: nonZeroBalances.length,
        latencyMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: "ERROR",
        connected: false,
        authenticated: false,
        latencyMs: Date.now() - startedAt,
        error:
          error instanceof Error
            ? error.message
            : String(error),
        checkedAt: new Date().toISOString(),
      };
    }
  }
}
