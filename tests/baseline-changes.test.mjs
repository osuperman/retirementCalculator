import test from 'node:test';
import assert from 'node:assert/strict';
import { baselineChanges } from '../src/ui/baselineChanges.js';
import { compareBaseline } from '../src/ui/planComparison.js';
import { DEFAULT_INPUTS } from '../src/finance/engine.js';

test('explains nested owner facts, conversion records, history and explicit zero without mutation', () => {
  const before = { mode:'couple', couple: { primary: { retirementAge:60 }, spouse: { priorEmployerWages:null, historicalMagi:{2024:null}, rothConversions:[{year:2025,amount:1000,taxableAmount:800}] }, shared:{inflation:0.03} } };
  const after = structuredClone(before);
  after.couple.primary.retirementAge = 61;
  after.couple.spouse.priorEmployerWages = 0;
  after.couple.spouse.historicalMagi[2024] = 0;
  after.couple.spouse.rothConversions[0].taxableAmount = 0;
  after.couple.shared.inflation = 0.03125;
  const snapshot = structuredClone({before,after});
  const changes = baselineChanges(before,after);
  assert.equal(changes.length,5);
  assert.deepEqual(changes.find(c => c.path === 'couple.spouse.historicalMagi.2024'), {
    path:'couple.spouse.historicalMagi.2024', label:'Spouse · Historical MAGI · 2024', before:'Unconfirmed', after:'$0.00',
  });
  assert.equal(changes.find(c => c.path === 'couple.primary.retirementAge').label,'Primary · Retirement age');
  assert.equal(changes.find(c => c.path === 'couple.spouse.priorEmployerWages').after,'$0.00');
  assert.equal(changes.find(c => c.path.endsWith('taxableAmount')).label,'Spouse · Roth conversion history · Entry 1 · Taxable amount');
  assert.equal(changes.find(c => c.path.endsWith('inflation')).after,'3.125%');
  assert.deepEqual({before,after},snapshot);
});

test('compares active mode assumptions only, explains a mode switch, and ignores schema metadata', () => {
  const before = {mode:'single',currentAge:45,scenarioVersion:1,couple:{primary:{currentAge:55}}};
  const inactiveChange = {...before,scenarioVersion:2,couple:{primary:{currentAge:60}}};
  assert.deepEqual(baselineChanges(before,inactiveChange),[]);
  const coupleBefore = {...before,mode:'couple'};
  assert.deepEqual(baselineChanges(coupleBefore,{...coupleBefore,currentAge:80}),[]);
  const changes = baselineChanges(before,coupleBefore);
  assert.deepEqual(changes.find(c => c.path === 'mode'),{path:'mode',label:'Planning mode',before:'Individual',after:'Married couple'});
  assert.ok(changes.some(c => c.path === 'couple.primary.currentAge'));
});

test('reports every changed history entry without truncation and distinguishes removed values', () => {
  const after = {mode:'single', historicalMagi:Object.fromEntries(Array.from({length:30},(_,i) => [2000+i,i]))};
  const changes = baselineChanges({mode:'single',historicalMagi:{}},after);
  assert.equal(changes.length,30);
  assert.equal(changes[0].before,'Not entered');
  const removed = baselineChanges(after,{mode:'single',historicalMagi:{}});
  assert.equal(removed.length,30);
  assert.equal(removed[0].after,'Not entered');
});

function projection(endYear,portfolioAtEnd,calculationValid=true) {
  return {yearlyData:[{year:2026,age:60,total:100,shortfall:0},{year:endYear,age:60+endYear-2026,total:portfolioAtEnd,shortfall:0}],summary:{portfolioAtEnd,calculationValid}};
}
test('ending comparison requires equal calendar horizons and exposes provisional status', () => {
  const inputs = {...DEFAULT_INPUTS};
  const baseline = {inputs,results:projection(2050,100)};
  const same = compareBaseline(baseline,inputs,projection(2050,150));
  assert.equal(same.beforeEnding,100);
  assert.equal(same.afterEnding,150);
  assert.equal(same.ending,50);
  assert.equal(same.provisional,false);
  const different = compareBaseline(baseline,inputs,projection(2051,150,false));
  assert.equal(different.beforeEnding,null);
  assert.equal(different.afterEnding,null);
  assert.equal(different.ending,null);
  assert.equal(different.beforeHorizon,2050);
  assert.equal(different.afterHorizon,2051);
  assert.equal(different.provisional,true);
  assert.equal(compareBaseline({...baseline,results:projection(2050,100,false)},inputs,projection(2050,150)).provisional,true);
});
