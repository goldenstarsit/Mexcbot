import assert from "node:assert/strict";
import DuplicateProtectionService from "../src/services/duplicateProtectionService.js";

function createFixture({
  makerResult = {
    orderId: "M66-SELL-ORDER-1",
    status: "NEW",
    symbol: "BTCUSDT",
    side: "SELL",
    type: "LIMIT_MAKER",
    price: "101",
    origQty: "0.01",
  },
  makerError = null,
  missingOrderId = false,
  repositoryError = null,
  localOrder = null,
  remoteOrder = null,
  existingIntent = null,
} = {}) {
  const intents = new Map();
  let nextIntentId = 1;
  let exchangeCalls = 0;
  let repositoryCalls = 0;

  const service = new DuplicateProtectionService({
    mexcClient: {
      async getOrder() {
        return remoteOrder;
      },
    },

    exchangeOrderRepository: {
      findByClientOrderId() {
        return localOrder;
      },

      async create(data) {
        repositoryCalls += 1;

        if (repositoryError) {
          throw repositoryError;
        }

        return {
          id: repositoryCalls,
          ...data,
        };
      },
    },

    makerOrderEngine: {
      async placeSell() {
        exchangeCalls += 1;

        if (makerError) {
          throw makerError;
        }

        if (missingOrderId) {
          return {
            status: "NEW",
          };
        }

        return makerResult;
      },
    },

    orderIntentRepository: {
      findByClientOrderId() {
        return existingIntent;
      },

      create(data) {
        const row = {
          id: nextIntentId++,
          ...data,
          status: "PENDING",
        };

        intents.set(row.id, row);
        return row;
      },

      markExchangePlaced(id, exchangeOrderId) {
        const row = intents.get(id) ?? existingIntent;

        if (!row) {
          throw new Error(`Intent ${id} not found`);
        }

        row.status = "EXCHANGE_PLACED";
        row.exchangeOrderId = exchangeOrderId;
        return row;
      },

      markResolved(id, exchangeOrderId) {
        const row = intents.get(id) ?? existingIntent;

        if (!row) {
          throw new Error(`Intent ${id} not found`);
        }

        row.status = "RESOLVED";
        row.exchangeOrderId = exchangeOrderId;
        return row;
      },

      markRecoveryRequired(id, error) {
        const row = intents.get(id) ?? existingIntent;

        if (!row) {
          throw new Error(`Intent ${id} not found`);
        }

        row.status = "RECOVERY_REQUIRED";
        row.error =
          error instanceof Error ? error.message : String(error);
        return row;
      },
    },
  });

  return {
    service,
    intents,
    getExchangeCalls: () => exchangeCalls,
    getRepositoryCalls: () => repositoryCalls,
  };
}

const baseSell = {
  tradingCycleId: 66,
  symbol: "BTCUSDT",
  quantity: 0.01,
  price: 101,
  bestBid: 100.9,
  clientOrderId: "m66-tp",
  reason: "TAKE_PROFIT",
  purpose: "exit",
};

// 1. Normal SELL placement.
{
  const fixture = createFixture();

  const result = await fixture.service.placeSell(baseSell);

  assert.equal(result.source, "NEW");
  assert.equal(result.reused, false);
  assert.equal(result.exchangeOrder.side, "SELL");
  assert.equal(result.exchangeOrder.orderType, "LIMIT_MAKER");
  assert.equal(fixture.getExchangeCalls(), 1);
  assert.equal(fixture.getRepositoryCalls(), 1);

  const intent = [...fixture.intents.values()][0];
  assert.equal(intent.status, "RESOLVED");

  console.log("M66 normal SELL: PASS");
}

// 2. Existing active LOCAL SELL must be reused.
{
  const fixture = createFixture({
    localOrder: {
      id: 10,
      trading_cycle_id: 66,
      symbol: "BTCUSDT",
      side: "SELL",
      client_order_id: "m66-local",
      exchange_order_id: "M66-LOCAL",
      status: "NEW",
      price: 101,
      quantity: 0.01,
    },
  });

  const result = await fixture.service.placeSell({
    ...baseSell,
    clientOrderId: "m66-local",
  });

  assert.equal(result.source, "LOCAL");
  assert.equal(result.reused, true);
  assert.equal(result.exchangeOrder.exchange_order_id, "M66-LOCAL");
  assert.equal(fixture.getExchangeCalls(), 0);
  assert.equal(fixture.getRepositoryCalls(), 0);

  console.log("M66 LOCAL SELL duplicate protection: PASS");
}

// 3. Remote SELL recovery must create the missing local order.
{
  const fixture = createFixture({
    remoteOrder: {
      orderId: "M66-REMOTE",
      clientOrderId: "m66-remote",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "LIMIT_MAKER",
      status: "NEW",
      price: "101",
      origQty: "0.01",
    },
  });

  const result = await fixture.service.placeSell({
    ...baseSell,
    clientOrderId: "m66-remote",
  });

  assert.equal(result.source, "EXCHANGE");
  assert.equal(result.reused, true);
  assert.equal(
    result.exchangeOrder.exchangeOrderId,
    "M66-REMOTE",
  );
  assert.equal(fixture.getExchangeCalls(), 0);
  assert.equal(fixture.getRepositoryCalls(), 1);

  const intent = [...fixture.intents.values()][0];
  assert.equal(intent.status, "RESOLVED");

  console.log("M66 remote SELL recovery: PASS");
}

// 4. Maker SELL failure must become RECOVERY_REQUIRED.
{
  const fixture = createFixture({
    makerError: new Error("M66 maker SELL rejection"),
  });

  await assert.rejects(
    fixture.service.placeSell({
      ...baseSell,
      clientOrderId: "m66-maker-error",
    }),
    /M66 maker SELL rejection/,
  );

  assert.equal(fixture.getExchangeCalls(), 1);
  assert.equal(fixture.getRepositoryCalls(), 0);

  const intent = [...fixture.intents.values()][0];
  assert.equal(intent.status, "RECOVERY_REQUIRED");

  console.log("M66 SELL placement failure recovery: PASS");
}

// 5. Missing exchange order ID must be recoverable.
{
  const fixture = createFixture({
    missingOrderId: true,
  });

  await assert.rejects(
    fixture.service.placeSell({
      ...baseSell,
      clientOrderId: "m66-missing-order-id",
    }),
    /MEXC exchange order ID is missing/,
  );

  assert.equal(fixture.getExchangeCalls(), 1);
  assert.equal(fixture.getRepositoryCalls(), 0);

  const intent = [...fixture.intents.values()][0];
  assert.equal(intent.status, "RECOVERY_REQUIRED");

  console.log("M66 missing SELL order ID recovery: PASS");
}

// 6. DB failure after exchange placement must become RECOVERY_REQUIRED.
{
  const fixture = createFixture({
    repositoryError: new Error("M66 SELL DB failure"),
  });

  await assert.rejects(
    fixture.service.placeSell({
      ...baseSell,
      clientOrderId: "m66-db-error",
    }),
    /M66 SELL DB failure/,
  );

  assert.equal(fixture.getExchangeCalls(), 1);
  assert.equal(fixture.getRepositoryCalls(), 1);

  const intent = [...fixture.intents.values()][0];
  assert.equal(intent.status, "RECOVERY_REQUIRED");

  console.log("M66 SELL DB failure recovery: PASS");
}

console.log("M66 SELL EXECUTION SAFETY: PASS");
console.log({
  normalSell: true,
  localDuplicateProtected: true,
  remoteRecovery: true,
  makerFailureRecovered: true,
  missingOrderIdRecovered: true,
  repositoryFailureRecovered: true,
});
