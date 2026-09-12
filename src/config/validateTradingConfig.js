const VALID_SYMBOLS = new Set([
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "TRXUSDT",
]);

export function validateTradingConfig(config) {
  if (!Array.isArray(config.symbols) || config.symbols.length === 0) {
    throw new Error("Trading config: symbols must be a non-empty array");
  }

  for (const symbol of config.symbols) {
    if (!VALID_SYMBOLS.has(symbol)) {
      throw new Error(`Trading config: unsupported symbol ${symbol}`);
    }
  }

  if (config.takeProfit <= 0) {
    throw new Error("Trading config: takeProfit must be greater than 0");
  }

  if (config.stopLoss <= 0 || config.stopLoss >= 100) {
    throw new Error("Trading config: stopLoss must be greater than 0 and less than 100");
  }

  if (config.initialOrder?.enabled !== true) {
    throw new Error("Trading config: initialOrder must be enabled");
  }

  if (config.dca?.enabled !== true) {
    throw new Error("Trading config: dca must be enabled");
  }

  if (config.dca?.formula !== "triangular") {
    throw new Error("Trading config: unsupported DCA formula");
  }

  if (config.dca?.levels !== 9) {
    throw new Error("Trading config: DCA levels must be 9 because total orders are 1 initial + 9 DCA");
  }

  if (config.order?.type !== "LIMIT_MAKER") {
    throw new Error("Trading config: order type must be LIMIT_MAKER");
  }

  if (config.order?.makerOnly !== true) {
    throw new Error("Trading config: makerOnly must be enabled");
  }

  return true;
}
