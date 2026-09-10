import test from 'node:test';
import assert from 'node:assert/strict';
import { hasNumericChanges } from '../src/ui/saveState.js';
import { DEFAULT_INPUTS, normalizeInputs } from '../src/finance/engine.js';

test('initial defaults and normalized legacy settings are clean', () => {
  const baseline = normalizeInputs(DEFAULT_INPUTS);
  assert.equal(hasNumericChanges(structuredClone(baseline), baseline), false);
  const legacy = { currentAge: 50, baseExpenses: 50000 };
  assert.equal(hasNumericChanges(normalizeInputs(legacy), normalizeInputs(legacy)), false);
});

test('numeric edits enable saving and reverting clears it', () => {
  const baseline = normalizeInputs(DEFAULT_INPUTS);
  const current = structuredClone(baseline);
  current.baseExpenses += 1;
  assert.equal(hasNumericChanges(current, baseline), true);
  current.baseExpenses = baseline.baseExpenses;
  assert.equal(hasNumericChanges(current, baseline), false);
  current.couple.spouse.currentAge += 1;
  assert.equal(hasNumericChanges(current, baseline), true);
});

test('text and boolean changes alone do not enable saving', () => {
  assert.equal(hasNumericChanges({ amount: 100, name: 'B', enabled: true }, { amount: 100, name: 'A', enabled: false }), false);
  assert.equal(hasNumericChanges({ amount: '100.00' }, { amount: 100 }), false);
});

test('optional numeric values distinguish missing, null and zero', () => {
  assert.equal(hasNumericChanges({ amount: 0 }, { amount: null }), true);
  assert.equal(hasNumericChanges({ amount: null }, { amount: 0 }), true);
  assert.equal(hasNumericChanges({ amount: '' }, { amount: 0 }), true);
  assert.equal(hasNumericChanges({}, { amount: 0 }), true);
});

test('numeric history additions, edits and removals are detected', () => {
  const baseline = { history: [{ year: 2025, amount: 1000 }] };
  assert.equal(hasNumericChanges({ history: [] }, baseline), true);
  assert.equal(hasNumericChanges({ history: [...baseline.history, { year: 2026, amount: 0 }] }, baseline), true);
  assert.equal(hasNumericChanges({ history: [{ year: 2025, amount: 1001 }] }, baseline), true);
  assert.equal(hasNumericChanges({ history: [{ amount: 1000, year: 2025 }] }, baseline), false);
});
