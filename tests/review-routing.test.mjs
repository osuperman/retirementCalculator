import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewItems, fieldReviews } from '../src/ui/reviewModel.js';

test('notice routing retains exact fallback and highlights only requested fields', () => {
  const message = 'Roth opening tax year is missing; earnings are treated as unqualified.';
  const items = buildReviewItems([message]);
  assert.equal(items[0].message, message);
  assert.equal(fieldReviews(items, 'individual', 'rothFirstContributionYear').length, 1);
  assert.equal(fieldReviews(items, 'individual', 'medicareStartYear').length, 0);
});
test('couple review routes owner facts separately and MAGI to household', () => {
  const inputs = {mode:'couple',couple:{primary:{name:'Alex'},spouse:{name:'Sam'}}};
  const items = buildReviewItems(['Sam: HSA coverage is unknown; no new HSA contributions are credited.', 'Alex: IRMAA lookback MAGI is missing for one or both pre-projection years; missing assessments use current-year income as an estimate.'], inputs);
  assert.equal(fieldReviews(items, 'spouse', 'hsaCoverage').length, 1);
  assert.equal(fieldReviews(items, 'primary', 'hsaCoverage').length, 0);
  assert.equal(fieldReviews(items, 'shared', 'historicalMagi').length, 1);
});
test('duplicate owner names offer both locations without silently choosing a spouse', () => {
  const inputs = {mode:'couple',couple:{primary:{name:'Alex'},spouse:{name:'Alex'}}};
  assert.deepEqual(buildReviewItems(['Alex: HSA coverage is unknown; no new HSA contributions are credited.'], inputs)[0].targets.map(t=>t.owner), ['primary','spouse']);
});
test('unknown and annual calculation notices are never dropped or mislabeled as missing fields', () => {
  const items = buildReviewItems(['New policy warning', '2040: Calculation did not converge']);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].targets, []);
  assert.equal(items[1].year, 2040);
});
