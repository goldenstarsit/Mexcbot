import assert from "node:assert/strict";
import CompleteMonitoringDashboardService from "../src/services/completeMonitoringDashboardService.js";

const service = new CompleteMonitoringDashboardService({
  botStatusService: {
    async getStatus() {
      return {
        status: "OK",
        environment: "development",
        liveTrading: false,
        database: { connected: true, sqliteVersion: "3.53.4" },
        mexc: { status: "OK", connected: true },
        mexcAccount: {
          status: "DISABLED",
          usdt: { free: "0", locked: "0" },
          tradingReady: false,
        },
        runtimeConfig: {
          version: 1,
          symbols: ["BTCUSDT"],
          takeProfit: 1,
          stopLoss: 50,
        },
      };
    },
  },
  exchangeOrderRepository: {
    findLiveOrders() {
      return [{ id: 1, symbol: "BTCUSDT", side: "BUY", status: "NEW" }];
    },
  },
  openPositionDashboardService: {
    getOpenPositions() {
      return [{ cycleId: 1, symbol: "BTCUSDT" }];
    },
  },
  dcaProgressDashboardService: {
    async getProgress() {
      return [{
        cycleId: 1,
        symbol: "BTCUSDT",
        completedLevels: 2,
        totalLevels: 9,
        progressPercent: 22.22,
      }];
    },
  },
  tpSlStatusDashboardService: {
    getStatus() {
      return [{ cycleId: 1, symbol: "BTCUSDT" }];
    },
  },
  capitalReservationDashboardService: {
    async getStatus() {
      return {
        reservation: {
          reservedUsdt: 5,
          usableUsdt: 95,
          activeCount: 1,
          pendingCount: 0,
        },
      };
    },
  },
  errorRecoveryDashboardService: {
    getStatus() {
      return {
        summary: {
          errorCount: 1,
          criticalCount: 0,
          recoverableOrders: 1,
          fillProcessingFailed: 0,
          recoveryExhausted: 0,
        },
      };
    },
  },
});

const result = await service.getStatus({ symbol: "BTCUSDT" });

assert.equal(result.status, "OK");
assert.equal(result.summary.openCycles, 1);
assert.equal(result.summary.liveOrders, 1);
assert.equal(result.summary.positions, 1);
assert.equal(result.summary.reservedUsdt, 5);
assert.equal(result.summary.usableUsdt, 95);
assert.equal(result.summary.errors, 1);
assert.equal(result.positions.length, 1);
assert.equal(result.dca.length, 1);
assert.equal(result.tpSl.length, 1);
assert.equal(result.liveOrders.count, 1);
assert.equal(result.filters.symbol, "BTCUSDT");

console.log("M107 COMPLETE MONITORING DASHBOARD: PASS");
console.log({
  runtimeHealth: true,
  liveOrders: true,
  openPositions: true,
  dcaProgress: true,
  tpSlStatus: true,
  capitalStatus: true,
  errorRecovery: true,
  symbolFilter: true,
  unifiedSummary: true
});
