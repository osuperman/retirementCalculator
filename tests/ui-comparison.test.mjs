import test from 'node:test';
import assert from 'node:assert/strict';
import { captureBaseline, baselineSeries, compareBaseline } from '../src/ui/planComparison.js';
import { DEFAULT_INPUTS, normalizeInputs, simulatePlan } from '../src/finance/engine.js';

test('baseline independently retains nested spouse facts and histories', () => {
  const inputs=normalizeInputs({...DEFAULT_INPUTS,mode:'couple'});
  inputs.couple.spouse.historicalMagi={2024:null,2025:0};
  inputs.couple.spouse.rothConversions=[{year:2025,amount:1000,taxableAmount:800}];
  const baseline=captureBaseline(inputs);
  inputs.couple.spouse.rothConversions[0].amount=999;
  inputs.couple.spouse.historicalMagi[2024]=50000;
  assert.equal(baseline.couple.spouse.rothConversions[0].amount,1000);
  assert.deepEqual(baseline.couple.spouse.historicalMagi,{2024:null,2025:0});
  const restored=captureBaseline(baseline);
  restored.couple.spouse.rothConversions.push({year:2026,amount:20});
  assert.equal(baseline.couple.spouse.rothConversions.length,1);
});

test('baseline chart aligns calendar years, leaves missing years empty, and adjusts dollars', () => {
  const baseline={inputs:{...DEFAULT_INPUTS,inflation:0.1},results:{yearlyData:[{year:2026,total:100},{year:2027,total:110}]}};
  assert.deepEqual(baselineSeries(baseline,[{year:2027},{year:2028}]),[110,null]);
  assert.ok(Math.abs(baselineSeries(baseline,[{year:2027}],true)[0]-100)<1e-9);
});

test('restoring a baseline reproduces the complete projection after a spending experiment', () => {
  const inputs=normalizeInputs(DEFAULT_INPUTS);
  const baseline={inputs:captureBaseline(inputs),results:simulatePlan(inputs)};
  const changed={...inputs,baseExpenses:inputs.baseExpenses+500};
  const delta=compareBaseline(baseline,changed,simulatePlan(changed));
  assert.equal(delta.spending,500);
  assert.equal(delta.changed,true);
  assert.deepEqual(simulatePlan(captureBaseline(baseline.inputs)),baseline.results);
  assert.equal(compareBaseline(baseline,inputs,baseline.results).changed,false);
});
