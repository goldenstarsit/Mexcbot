import assert from "node:assert/strict";
import PositionCalculator from "../src/services/positionCalculator.js";

const calculator = new PositionCalculator();

function assertPosition(fills, expected) {
  const result = calculator.calculate(fills);

  assert.ok(
    Math.abs(result.totalQuantity - expected.totalQuantity) < 1e-12,
    `totalQuantity: expected ${expected.totalQuantity}, got ${result.totalQuantity}`,
  );

  assert.ok(
    Math.abs(result.totalCost - expected.totalCost) < 1e-12,
    `totalCost: expected ${expected.totalCost}, got ${result.totalCost}`,
  );

  assert.ok(
    Math.abs(result.averagePrice - expected.averagePrice) < 1e-12,
    `averagePrice: expected ${expected.averagePrice}, got ${result.averagePrice}`,
  );

  return result;
}

// 1. Empty position
assertPosition([], {
  totalQuantity: 0,
  totalCost: 0,
  averagePrice: 0,
});

// 2. Single BUY
assertPosition(
  [{ side: "BUY", quantity: 0.01, price: 100 }],
  {
    totalQuantity: 0.01,
    totalCost: 1,
    averagePrice: 100,
  },
);

// 3. Equal-quantity BUY fills
assertPosition(
  [
    { side: "BUY", quantity: 0.01, price: 100 },
    { side: "BUY", quantity: 0.01, price: 90 },
  ],
  {
    totalQuantity: 0.02,
    totalCost: 1.9,
    averagePrice: 95,
  },
);

// 4. Unequal-quantity BUY fills — weighted average
assertPosition(
  [
    { side: "BUY", quantity: 0.01, price: 100 },
    { side: "BUY", quantity: 0.02, price: 90 },
    { side: "BUY", quantity: 0.03, price: 80 },
  ],
  {
    totalQuantity: 0.06,
    totalCost: 5.2,
    averagePrice: 86.66666666666667,
  },
);

// 5. Multiple/partial fills
const partialFills = [
  { side: "BUY", quantity: 0.003, price: 100 },
  { side: "BUY", quantity: 0.004, price: 99 },
  { side: "BUY", quantity: 0.003, price: 101 },
  { side: "BUY", quantity: 0.005, price: 97 },
];

const partialResult = assertPosition(
  partialFills,
  {
    totalQuantity: 0.015,
    totalCost: 1.484,
    averagePrice: 98.93333333333333,
  },
);

// 6. SELL fills must not affect BUY position average
assertPosition(
  [
    ...partialFills,
    { side: "SELL", quantity: 0.005, price: 120 },
    { side: "SELL", quantity: 0.002, price: 125 },
  ],
  {
    totalQuantity: 0.015,
    totalCost: 1.484,
    averagePrice: 98.93333333333333,
  },
);

// 7. Fill ordering must not change the weighted average
const reorderedResult = calculator.calculate([
  partialFills[3],
  partialFills[1],
  partialFills[0],
  partialFills[2],
]);

assert.equal(
  reorderedResult.totalQuantity,
  partialResult.totalQuantity,
);

assert.equal(
  reorderedResult.totalCost,
  partialResult.totalCost,
);

assert.ok(
  Math.abs(
    reorderedResult.averagePrice -
      partialResult.averagePrice,
  ) < 1e-12,
);

// 8. Real M68-style initial + DCA fills
const m68StyleFills = [
  { side: "BUY", quantity: 0.01, price: 100 },
  { side: "BUY", quantity: 0.01, price: 101 },
  { side: "BUY", quantity: 0.01, price: 103 },
];

assertPosition(
  m68StyleFills,
  {
    totalQuantity: 0.03,
    totalCost: 3.04,
    averagePrice: 101.33333333333334,
  },
);

// 9. Invalid BUY quantity must be rejected
assert.throws(
  () =>
    calculator.calculate([
      { side: "BUY", quantity: 0, price: 100 },
    ]),
  /BUY fill quantity must be greater than 0/,
);

// 10. Invalid BUY price must be rejected
assert.throws(
  () =>
    calculator.calculate([
      { side: "BUY", quantity: 0.01, price: 0 },
    ]),
  /BUY fill price must be greater than 0/,
);

console.log("M73 AVERAGE PRICE VERIFICATION:");
console.log({
  singleBuy: 100,
  equalQuantityAverage: 95,
  unequalQuantityAverage: 86.66666666666667,
  partialFillAverage: partialResult.averagePrice,
  partialFillQuantity: partialResult.totalQuantity,
  partialFillCost: partialResult.totalCost,
  sellFillsIgnored: true,
  orderIndependent: true,
  m68StyleAverage: 101.33333333333334,
  invalidQuantityRejected: true,
  invalidPriceRejected: true,
});

console.log("M73 AVERAGE PRICE VERIFICATION: PASS");
console.log("M73 TEST: PASS");
