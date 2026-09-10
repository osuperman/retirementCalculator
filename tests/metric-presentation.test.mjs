import test from 'node:test';
import assert from 'node:assert/strict';
import { moneyMetric } from '../src/ui/metricPresentation.js';
test('missing, rounded-small, exact zero, unused and depleted balances remain distinct', () => {
  assert.equal(moneyMetric(null), 'Unavailable');
  assert.equal(moneyMetric(undefined), 'Unavailable');
  assert.equal(moneyMetric(NaN), 'Unavailable');
  assert.equal(moneyMetric(0.1, {depleted:true}), '<$1');
  assert.equal(moneyMetric(0), '$0');
  assert.equal(moneyMetric(0, {none:true}), 'None');
  assert.equal(moneyMetric(0, {depleted:true}), 'Depleted');
});
