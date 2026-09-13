const tradingConfig = {
  symbols: [
    "BTCUSDT",
    "ETHUSDT",
    "BNBUSDT",
    "SOLUSDT",
    "TRXUSDT",
  ],

  takeProfit: 1,
  stopLoss: 50,

  initialOrder: {
    enabled: true,
  },

  dca: {
    enabled: true,
    formula: "triangular",
    levels: 9,
  },

  order: {
    type: "LIMIT_MAKER",
    makerOnly: true,
  },

  terminalRecovery: {
    maxAttempts: 5,
  },

  fillProcessing: {
    maxAttempts: 5,
  },
};

export default tradingConfig;
