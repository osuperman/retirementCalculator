import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOutlook } from '../src/ui/outlookModel.js';

const rows = Array.from({ length: 36 }, (_, index) => ({ age: 60 + index, year: 2026 + index, total: index >= 30 ? 0 : 1000000 }));
const shortfall = { status: 'danger', firstShortfallAge: 90, firstShortfallYear: 2056 };
test('outlook locates age 90 on the same annual series as the balance curve', () => {
  const result = buildOutlook(rows, shortfall);
  assert.equal(result.shortfallRow, rows[30]);
  assert.equal(result.age, 90);
  assert.equal(result.depleted, true);
  assert.equal(result.detail, '5 years short of your age 95 target.');
  assert.equal((result.shortfallRow.age - result.first.age) / (result.last.age - result.first.age), 30 / 35);
});
test('cash-flow shortfall with remaining assets does not claim depletion', () => {
  const fundedAssets = rows.map(row => ({ ...row, total: 50000 }));
  const result = buildOutlook(fundedAssets, shortfall);
  assert.equal(result.depleted, false);
  assert.equal(result.headline, 'Projected shortfall at age');
  assert.match(result.detail, /Some assets remain/);
});
test('unresolved calculations never receive an on-track headline', () => {
  const result = buildOutlook(rows, { status: 'ok' }, false);
  assert.equal(result.headline, 'Calculation needs review');
  assert.equal(result.age, null);
  assert.equal(result.tone, 'caution');
  assert.equal(buildOutlook(rows, shortfall, false).label, 'Estimate needs review');
});
test('funded, thin margin, empty and single-year projections are supported', () => {
  assert.equal(buildOutlook(rows, { status: 'ok' }).age, 95);
  assert.equal(buildOutlook(rows, { status: 'warning' }).label, 'Thin margin');
  assert.deepEqual(buildOutlook([], { status: 'ok' }).ticks, []);
  assert.deepEqual(buildOutlook([rows[0]], { status: 'ok' }).ticks, [60]);
});
