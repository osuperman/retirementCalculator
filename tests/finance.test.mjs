import test from 'node:test';
import assert from 'node:assert/strict';
import { runSelfTests } from '../src/finance/engine.js';

test('all existing production diagnostics', () => {
  const result = runSelfTests();
  assert.equal(result.failed, 0, JSON.stringify(result.results.filter(r => !r.passed)));
  assert.equal(result.total, 172);
});
