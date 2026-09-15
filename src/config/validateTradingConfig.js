const VALID_SYMBOLS = new Set([
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "TRXUSDT",
]);

function requireFiniteNumber(value, name) {
  if (!Number.isFinite(Number(value))) {
    throw new Error(`Trading config: ${name} must be a finite number`);
  }
}

function requirePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `Trading config: ${name} must be a positive integer`,
    );
  }
}

export function validateTradingConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Trading config must be an object");
  }

  if (!Array.isArray(config.symbols) || config.symbols.length === 0) {
    throw new Error(
      "Trading config: symbols must be a non-empty array",
    );
  }

  const seenSymbols = new Set();

  for (const symbol of config.symbols) {
    if (typeof symbol !== "string" || !VALID_SYMBOLS.has(symbol)) {
      throw new Error(
        `Trading config: unsupported symbol ${symbol}`,
      );
    }

    if (seenSymbols.has(symbol)) {
      throw new Error(
        `Trading config: duplicate symbol ${symbol}`,
      );
    }

    seenSymbols.add(symbol);
  }

  requireFiniteNumber(config.takeProfit, "takeProfit");

  if (Number(config.takeProfit) <= 0) {
    throw new Error(
      "Trading config: takeProfit must be greater than 0",
    );
  }

  requireFiniteNumber(config.stopLoss, "stopLoss");

  if (
    Number(config.stopLoss) <= 0 ||
    Number(config.stopLoss) >= 100
  ) {
    throw new Error(
      "Trading config: stopLoss must be greater than 0 and less than 100",
    );
  }

  if (config.initialOrder?.enabled !== true) {
    throw new Error(
      "Trading config: initialOrder must be enabled",
    );
  }

  if (config.dca?.enabled !== true) {
    throw new Error(
      "Trading config: dca must be enabled",
    );
  }

  if (config.dca?.formula !== "triangular") {
    throw new Error(
      "Trading config: unsupported DCA formula",
    );
  }

  if (config.dca?.levels !== 9) {
    throw new Error(
      "Trading config: DCA levels must be 9 because total orders are 1 initial + 9 DCA",
    );
  }

  if (config.order?.type !== "LIMIT_MAKER") {
    throw new Error(
      "Trading config: order type must be LIMIT_MAKER",
    );
  }

  if (config.order?.makerOnly !== true) {
    throw new Error(
      "Trading config: makerOnly must be enabled",
    );
  }

  requirePositiveInteger(
    config.terminalRecovery?.maxAttempts,
    "terminalRecovery.maxAttempts",
  );

  requirePositiveInteger(
    config.fillProcessing?.maxAttempts,
    "fillProcessing.maxAttempts",
  );

  return true;
}
