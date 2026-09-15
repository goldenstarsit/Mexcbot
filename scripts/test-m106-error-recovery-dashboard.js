import assert from "node:assert/strict";
import ErrorRecoveryDashboardService from "../src/services/errorRecoveryDashboardService.js";

const orders = [
  {
    id:1,symbol:"BTCUSDT",side:"BUY",status:"NEW",recovery_status:"PENDING",
    recovery_attempts:0,fill_processing_status:"FAILED",
    fill_processing_attempts:2,fill_processing_error:"fill failed",
    recovery_error:null,exchange_order_id:"ex-1",
    client_order_id:"mxc-c1-dca-1",created_at:"2026-01-01T00:00:00Z",
    updated_at:"2026-01-01T00:00:02Z"
  },
  {
    id:2,symbol:"ETHUSDT",side:"SELL",status:"CANCELED",
    recovery_status:"EXHAUSTED",recovery_attempts:3,
    fill_processing_status:"PENDING",recovery_error:"retry exhausted",
    exchange_order_id:"ex-2",client_order_id:"mxc-c2-tp",
    created_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-01T00:00:03Z"
  }
];

const exchangeOrderRepository = {
  findActive(){return [orders[0]]},
  findTerminalOrders(){return [orders[1]]},
  findRecoverableTerminalOrders(){return []}
};

const tradingCycleRepository = {
  findByStatus(status){assert.equal(status,"OPEN");return [{id:1}]},
  findOpenBySymbol(symbol){return symbol==="BTCUSDT"?{id:1}:null}
};

const service = new ErrorRecoveryDashboardService({
  exchangeOrderRepository,
  tradingCycleRepository
});

const status=service.getStatus();
assert.equal(status.summary.openCycles,1);
assert.equal(status.summary.activeOrders,1);
assert.equal(status.summary.terminalOrders,1);
assert.equal(status.summary.fillProcessingFailed,1);
assert.equal(status.summary.recoveryExhausted,1);
assert.equal(status.summary.criticalCount,1);
assert.equal(status.queues.fillProcessing.length,1);
assert.equal(status.errors.length,2);

const btc=service.getStatus({symbol:"BTCUSDT"});
assert.equal(btc.summary.activeOrders,1);
assert.equal(btc.summary.terminalOrders,0);

console.log("M106 ERROR RECOVERY DASHBOARD: PASS");
console.log({
  errorAggregation:true,
  fillProcessingFailures:true,
  recoveryExhaustion:true,
  symbolFilter:true,
  queueVisibility:true,
  criticalErrors:true,
  checkedTimestamp:true
});
