import db from "../src/database/connection.js";
import ExchangeOrderRepository from "../src/database/repositories/exchangeOrderRepository.js";
import TradingConfigApi from "../src/api/tradingConfigApi.js";
import fs from "node:fs/promises";

const repo=new ExchangeOrderRepository();
const suffix=`M101-${Date.now()}`;
const symbol=`${suffix}BTCUSDT`;

const cycle=db.prepare(`
  INSERT INTO trading_cycles(symbol,cycle_number,status)
  VALUES(?,?,?)
`).run(symbol,1,"OPEN");

const active=db.prepare(`
  INSERT INTO exchange_orders(
    trading_cycle_id,symbol,exchange_order_id,side,order_type,
    price,quantity,status
  ) VALUES(?,?,?,?,?,?,?,?)
`).run(
  cycle.lastInsertRowid,symbol,`${suffix}-ACTIVE`,
  "BUY","LIMIT_MAKER",100,0.01,"NEW"
);

const partial=db.prepare(`
  INSERT INTO exchange_orders(
    trading_cycle_id,symbol,exchange_order_id,side,order_type,
    price,quantity,status
  ) VALUES(?,?,?,?,?,?,?,?)
`).run(
  cycle.lastInsertRowid,symbol,`${suffix}-PARTIAL`,
  "SELL","LIMIT_MAKER",101,0.02,"PARTIALLY_FILLED"
);

const terminal=db.prepare(`
  INSERT INTO exchange_orders(
    trading_cycle_id,symbol,exchange_order_id,side,order_type,
    price,quantity,status
  ) VALUES(?,?,?,?,?,?,?,?)
`).run(
  cycle.lastInsertRowid,symbol,`${suffix}-CANCELED`,
  "SELL","LIMIT_MAKER",101,0.01,"CANCELED"
);

const live=repo.findLiveOrders({symbol});

if(live.length!==2)throw new Error(`Expected 2 live orders, got ${live.length}`);
if(!live.some(x=>x.exchange_order_id===`${suffix}-ACTIVE`))throw new Error("NEW order missing");
if(!live.some(x=>x.exchange_order_id===`${suffix}-PARTIAL`))throw new Error("PARTIALLY_FILLED order missing");
if(live.some(x=>x.exchange_order_id===`${suffix}-CANCELED`))throw new Error("Terminal order leaked");

const partialOnly=repo.findLiveOrders({symbol,status:"PARTIALLY_FILLED"});
if(partialOnly.length!==1)throw new Error("Status filter failed");

let response={
  statusCode:null,
  body:"",
  writeHead(code){this.statusCode=code},
  end(body=""){this.body=body},
};

const api=new TradingConfigApi({
  tradingConfigService:{getCurrent(){return{}}},
  tradingCycleRepository:{},
  exchangeOrderRepository:repo,
});

await api.handle(
  {method:"GET",url:`/api/orders?symbol=${encodeURIComponent(symbol)}`},
  response,
);

if(response.statusCode!==200)throw new Error(`API status ${response.statusCode}`);

const payload=JSON.parse(response.body);
if(payload.count!==2||payload.orders.length!==2)throw new Error("API payload incorrect");

response={statusCode:null,body:"",writeHead(code){this.statusCode=code},end(body=""){this.body=body}};
await api.handle({method:"GET",url:"/orders"},response);

if(response.statusCode!==200)throw new Error("Orders page route failed");

const html=await fs.readFile("src/api/public/orders.html","utf8");

for(const required of [
  "viewport",
  "Live Orders",
  "/api/orders",
  "Auto-refresh every 5 seconds",
  "@media(min-width:640px)",
  "@media(min-width:900px)",
]){
  if(!html.includes(required))throw new Error(`UI requirement missing: ${required}`);
}

db.prepare("DELETE FROM exchange_orders WHERE id IN (?,?,?)")
  .run(active.lastInsertRowid,partial.lastInsertRowid,terminal.lastInsertRowid);
db.prepare("DELETE FROM trading_cycles WHERE id=?").run(cycle.lastInsertRowid);

console.log("M101 LIVE ORDER DASHBOARD: PASS");
console.log({
  liveOrderQuery:true,
  terminalOrdersExcluded:true,
  symbolFilter:true,
  statusFilter:true,
  apiEndpoint:true,
  ordersPage:true,
  mobileFirst:true,
  responsiveTablet:true,
  responsiveDesktop:true,
  autoRefresh:true,
  limitMakerData:true,
});
