import test from 'node:test';
import assert from 'node:assert/strict';
import {simulate,simulateCouple,totalTax,runMonteCarlo,normalizeInputs,parseSettingsText,solveMaxSustainableSpending} from '../src/finance/engine.js';
import {zero,couple} from './fixtures.mjs';
import {distributionYears,hsaEligibleFraction,socialSecurityPaid,coupleHsaRooms,coupleQualifiedHsa,initialRothLayers} from '../src/finance/policy.js';
import {provisionalRothLayers,commitRothConversion} from '../src/finance/numerics.js';
const near=(actual,expected,tol=1)=>assert.ok(Math.abs(actual-expected)<=tol,`${actual} != ${expected}`);
test('1 same-year Roth conversions precede earnings',()=>{
 const r=simulate({...zero,currentAge:50,retirementAge:50,planThroughAge:50,balance401k:100000,balanceRoth:100000,conversionBridge:100000,baseExpenses:20000}).yearlyData[0];
 near(r.tax,22255);near(r.fromRoth,42255);
});
test('2 accumulation contributions cannot exceed compensation',()=>{
 const input={...zero,currentAge:50,retirementAge:51,planThroughAge:51,salaryIncome:10000,contrib401k:30000};
 assert.ok(simulate(input).yearlyData[0].contribution401kApplied<=10000);
 assert.ok(simulateCouple(couple(input,{currentAge:50,retirementAge:51,planThroughAge:51})).yearlyData[0].ownerDetails.primary.contribution401kApplied<=10000);
});
test('3 part-time W2 pay incurs employee FICA',()=>{
 const r=simulate({...zero,balanceCash:100000,partTimeIncome:60000,partTimeYears:1,baseExpenses:40000}).yearlyData[0];
 near(r.cash,107747);near(r.ficaTax,4590);
 const c=simulateCouple(couple({partTimeIncome:60000,partTimeYears:1},{},{balanceCash:100000,baseExpenses:40000})).yearlyData[0];
 near(c.ficaTax,4590);
});
test('4 RMD obligations cannot cross employer-plan and IRA categories',()=>{
 const p={currentAge:75,retirementAge:75,planThroughAge:75,balance401k:500000,balanceTradIra:500000};
 for(const r of [simulate({...zero,...p}).yearlyData[0],simulateCouple(couple(p,{currentAge:75,retirementAge:75,planThroughAge:75})).yearlyData[0]]){
  near(r.from401k,500000/24.6);near(r.fromIra,500000/24.6);
 }
});
test('5 each senior deduction phases out independently',()=>near(totalTax(250000,0,2026,0,0,0,0,2,'mfj'),50479.05,.01));
test('6 credited cash interest equals taxable interest',()=>{
 const r=simulate({...zero,balanceCash:1000000,cashReturn:.05,baseExpenses:900000}).yearlyData[0];
 near(r.cash,105000);near(r.tax,0);near(r.magi,5000);
});
test('8 adequate assets do not produce a numerical shortfall',()=>{
 const r=simulate({...zero,currentAge:50,retirementAge:50,planThroughAge:50,balanceTradIra:5000000,baseExpenses:200000}).yearlyData[0];
 near(r.grossWithdrawal,337666);near(r.unmetCashFlow,0);
});
test('9 explicit zero volatility is deterministic',()=>{
 const r=runMonteCarlo({...zero,balanceRoth:1000000,baseExpenses:50000,portfolioVolatility:0},20);
 near(r.finalP10,950000);near(r.finalP90,950000);
});
test('11 nonqualified annuity earnings enter NIIT without private NY exclusion',()=>{
 const r=simulate({...zero,balanceInherited:100000,inheritedPlanType:'nonqualifiedAnnuity',inheritedNyEligible:false,inheritedBasis:0,inheritedDeathYear:2025,inheritedDeceasedBirthYear:1950,inheritedContractFinalDistributionMode:'explicitYear',inheritedContractFinalDistributionYear:2026,pensionIncome:200000,pensionNyExempt:true}).yearlyData[0];
 near(r.tax,76794);
});

test('10 return calendar covers the longest actual couple horizon',()=>{
 const input={mode:'couple',couple:couple({currentAge:45,retirementAge:65,planThroughAge:95},{currentAge:75,retirementAge:75,planThroughAge:95})};
 assert.equal(distributionYears(input,2026),51);
 assert.throws(()=>simulateCouple(input.couple,{yearlyReturns:Array(41).fill(0)}),/Missing investment return/);
});

test('12 HSA contribution months and premium qualification',()=>{
 assert.equal(hsaEligibleFraction({hsaCoverage:'self',medicareStartYear:2026,medicareStartMonth:7},65,2026),.5);
 assert.equal(hsaEligibleFraction({hsaCoverage:'unknown'},60,2026),0);
 const r=simulate({...zero,balanceHsa:100000,balanceCash:50000,healthcarePre65:10000}).yearlyData[0];
 assert.equal(r.hsaWithdrawal,0);near(r.hsa,100000);
});

test('14 earnings test pays zero benefits in the audited working scenario',()=>{
 const r=simulate({...zero,currentAge:62,retirementAge:63,planThroughAge:63,ssAge:62,ssIncome:40000,salaryIncome:100000}).yearlyData[0];
 assert.equal(r.ss,0);
 for(const wages of [24479,24480,24481]) {
  const r=socialSecurityPaid({ssAge:62},62,2026,67,28000,wages,0,{withheldMonths:0});
  near(r.paid,28000-Math.max(0,wages-24480)/2,.001);
 }
});

test('15 mandatory Roth catch-up retains tax character and current wage base',()=>{
 const p={currentAge:55,retirementAge:56,planThroughAge:56,salaryIncome:200000,priorEmployerWages:200000,rothCatchupAvailable:true,contrib401k:32500};
 const r=simulate({...zero,...p}).yearlyData[0];
 assert.equal(r.contributionRoth401kApplied,8000);near(r.roth401k,8000);near(r.taxableWages,175500);
 const c=simulateCouple(couple(p,{currentAge:55,retirementAge:56,planThroughAge:56})).yearlyData[0];
 assert.equal(c.ownerDetails.primary.contributionRoth401kApplied,8000);
 assert.equal(c.ownerDetails.primary.contribution401kApplied,32500);
 const draw=simulateCouple(couple({currentAge:65,retirementAge:65,planThroughAge:65,balanceRoth401k:100000,roth401kBasis:80000,roth401kFirstYear:2020},{},{baseExpenses:10000})).yearlyData[0];
 near(draw.unmetCashFlow,0);near(draw.total,90000);
});

test('12 both spouses prorate the shared HSA pool and individual catch-ups',()=>{
 const p={hsaCoverage:'family',hsaEligibleMonths:12,medicareStartYear:2026,medicareStartMonth:7};
 const first=coupleHsaRooms(p,p,65,65,2026,4400,8750);
 const second=coupleHsaRooms(p,p,65,65,2026,4400,8750,first.primary);
 near(first.primary,4875,.001);near(second.spouse,500,.001);
 const medical=coupleQualifiedHsa(10000,10000,{hsaQualifiedExpenses:0},{hsaQualifiedPremiums:5000,hsaPremiumType:'medicare'},60,65,1,5000);
 assert.equal(medical.primary,0);assert.equal(medical.spouse,5000);
});

test('1 and 16 same-year conversion layers aggregate taxable principal first without mutation',()=>{
 const layers=initialRothLayers({balanceRoth:10000,rothConversions:[{year:2026,amount:10000,taxableAmount:0}],rothFirstContributionYear:2026});
 const provisional=provisionalRothLayers(layers,20000,2026);
 assert.deepEqual(provisional.vintages,[{year:2026,amount:30000,taxableAmount:20000}]);
 assert.equal(layers.vintages[0].amount,10000);
 const empty=initialRothLayers({balanceRoth:0});commitRothConversion(empty,1000,2026);assert.equal(empty.firstYear,2026);
});

test('individual MFJ and couple projection agree for equivalent income and ownership',()=>{
 for(const age of [50,60,75]) {
  const p={...zero,currentAge:age,retirementAge:age,planThroughAge:age,balance401k:100000,balanceTradIra:100000,balanceRoth:100000,rothBasis:100000,pensionIncome:30000,partTimeIncome:60000,partTimeYears:1};
  const individual=simulate({...p,filingStatus:'mfj',householdSize:2,balanceCash:100000,baseExpenses:80000}).yearlyData[0];
  const married=simulateCouple(couple(p,{currentAge:age,retirementAge:age,planThroughAge:age},{balanceCash:100000,baseExpenses:80000})).yearlyData[0];
  near(individual.tax,married.tax,1);near(individual.total,married.total,1);
 }
});

test('16 Roth earnings require the separate qualification clock',()=>{
 const base={...zero,balanceRoth:100000,rothBasis:80000,baseExpenses:200000,pensionIncome:100000};
 const old=simulate({...base,rothFirstContributionYear:2020}).yearlyData[0];
 const young=simulate({...base,rothFirstContributionYear:2024}).yearlyData[0];
 near(young.tax-old.tax,4887.75,.01);near(young.magi,120000);near(old.magi,100000);
});

test('17 disqualifying coverage yields no premium tax credit',()=>{
 const r=simulate({...zero,pensionIncome:60000,healthcarePre65:30000,useAcaSubsidyEstimate:true,acaEligible:false,acaAnnualPremium:30000,acaBenchmarkPremium:30000}).yearlyData[0];
 assert.equal(r.acaSubsidy,0);
});

test('19 actual two-year MAGI governs IRMAA',()=>{
 const r=simulate({...zero,currentAge:65,retirementAge:65,planThroughAge:65,pensionIncome:50000,historicalMagi:{2024:150000}}).yearlyData[0];
 near(r.irmaaSurcharge,2884.8);
});

test('18 death stops duplicate SS and changes filing status in the following year',()=>{
 for(const reverse of [false,true]) {
  const deceased={currentAge:70,retirementAge:70,planThroughAge:72,ssAge:67,ssIncome:40000,deathYear:2026,deathMonth:12,spouseInheritance:'own',pensionSurvivorFraction:0};
  const survivor={currentAge:70,retirementAge:70,planThroughAge:72,ssAge:67,ssIncome:20000};
  const rows=simulateCouple(couple(reverse?survivor:deceased,reverse?deceased:survivor)).yearlyData;
  near(rows[1].ss,42133);assert.equal(rows[0].filingStatus,'mfj');assert.equal(rows[1].filingStatus,'single');
 }
});

test('18 spousal account transfer conserves assets and retains IRA character',()=>{
 const rows=simulateCouple(couple({currentAge:60,retirementAge:60,planThroughAge:62,balance401k:100000,balanceTradIra:50000,balanceRoth:40000,rothBasis:40000,balanceHsa:10000,deathYear:2026,deathMonth:12,spouseInheritance:'own'},{currentAge:60,retirementAge:60,planThroughAge:62})).yearlyData;
 near(rows[0].total,200000);near(rows[1].total,200000);near(rows[1].tradIra,150000);
});

test('20 HSA after 65 can fund nonmedical costs with ordinary income tax',()=>{
 const p={currentAge:70,retirementAge:70,planThroughAge:70,balanceHsa:100000};
 const r=simulate({...zero,...p,baseExpenses:10000}).yearlyData[0];
 near(r.grossWithdrawal,10081);near(r.unmetCashFlow,0);near(r.hsa,89919);
 const c=simulateCouple(couple(p,{},{baseExpenses:10000})).yearlyData[0];
 near(c.unmetCashFlow,0);assert.ok(c.taxableHsaWithdrawal>=10000);
});

test('13 SEPP account cannot supply discretionary extra withdrawals',()=>{
 const p={...zero,currentAge:50,retirementAge:50,planThroughAge:50,balanceTradIra:1000000,baseExpenses:120000,useSepp:true,seppAccountAmount:1000000,seppStartDate:'2026-01-01',birthDate:'1976-01-01',seppRate:.05};
 for(const r of [simulate(p).yearlyData[0],simulateCouple(couple(p,{},{baseExpenses:120000})).yearlyData[0]]) {
  near(r.seppIncome,60312);near(r.seppBalance,939688);near(r.fromIra,r.seppIncome);near(r.grossWithdrawal,r.seppIncome);
  assert.ok(r.unmetCashFlow>50000);assert.equal(r.earlyPenalty,0);
 }
});

test('4 working five-percent owner distributes employer RMD without creating money',()=>{
 const p={...zero,currentAge:75,retirementAge:76,planThroughAge:76,balance401k:500000,fivePercentOwner:true};
 for(const r of [simulate(p).yearlyData[0],simulateCouple(couple(p,{currentAge:75,retirementAge:76,planThroughAge:76})).yearlyData[0]]) {
  near(r.k401,500000-500000/24.6);near(r.total+r.tax,500000,2);
 }
});

test('17 ordinary brokerage yield enters MAGI and reinvested basis without duplicate growth',()=>{
 const p={...zero,balanceTaxable:100000,taxableBasisPct:1,taxableOrdinaryYield:.05,postReturn:.05,taxableAnnualTaxDrag:.005};
 for(const r of [simulate(p).yearlyData[0],simulateCouple(couple({},{},{...p})).yearlyData[0]]) {
  near(r.total,105000);near(r.magi,5000);near(r.taxableBasisEnd,105000);
 }
});

test('7 unresolved subsidy regimes are never certified as sustainable',()=>{
 const p={...zero,balanceTradIra:1000000,healthcarePre65:30000,useAcaSubsidyEstimate:true,acaEligible:true,acaAnnualPremium:30000,acaBenchmarkPremium:30000};
 const r=simulate(p);
 assert.equal(r.yearlyData[0].calculationValid,false);
 assert.equal(r.yearlyData[0].acaSubsidy,0);assert.equal(solveMaxSustainableSpending(p),null);
 near(r.yearlyData[0].tax,1781.21,.01);
});

test('new nested financial facts round-trip through complete scenario import',()=>{
 const input=normalizeInputs({mode:'couple',couple:couple({rothFirstContributionYear:2015,rothConversions:[{year:2023,amount:30000,taxableAmount:20000}],deathYear:2040,spouseInheritance:'own'},{hsaCoverage:'family'},{historicalMagi:{2024:150000,2025:200000},acaEligible:true,acaBenchmarkPremium:20000})});
 const parsed=parseSettingsText(`Scenario data v2: ${JSON.stringify(input)}`);
 assert.equal(parsed.completeScenario,true);assert.deepEqual(parsed.updates,input);
});

test('zero-return retirement money conservation across account switches',()=>{
 for(const age of [50,55,60,65,75]) for(const expense of [0,10000,80000,400000]) {
  const p={...zero,currentAge:age,retirementAge:age,planThroughAge:age,balanceCash:10000,balanceTaxable:20000,balance401k:30000,balanceTradIra:40000,balanceRoth:50000,rothBasis:25000,balanceHsa:10000,baseExpenses:expense,partTimeIncome:60000,partTimeYears:1,pensionIncome:30000};
  const r=simulate(p).yearlyData[0];
  near(r.total,160000+60000+r.pension-r.ficaTax-r.spending-r.tax+r.unmetCashFlow,2);
  const c=simulateCouple(couple(p,{currentAge:age,retirementAge:age,planThroughAge:age},{balanceCash:10000,balanceTaxable:20000,baseExpenses:expense})).yearlyData[0];
  near(c.total,160000+60000+c.pension-c.ficaTax-c.spending-c.tax+c.unmetCashFlow,2);
 }
});


test('malformed imported financial history is rejected before simulation',()=>{
 for(const facts of [{rothConversions:{}},{historicalMagi:{2024:'150000'}},{ssMonthlyEarnings:{2026:[1,2]}},{acaEligible:'false'},{rothConversions:[{year:2024,amount:100,taxableAmount:200}]}]) {
  const parsed=parseSettingsText(`Scenario data v2: ${JSON.stringify({...zero,...facts})}`);
  assert.equal(parsed.completeScenario,undefined);assert.equal(parsed.applied.length,0);assert.equal(parsed.skipped.length,1);
 }
});

test('prior-employer plans do not inherit an unrelated age-55 separation exemption',()=>{
 const p={...zero,currentAge:56,retirementAge:56,planThroughAge:56,balance401k:100000,baseExpenses:10000,currentEmployerPlan:false};
 for(const r of [simulate(p).yearlyData[0],simulateCouple(couple(p,{},{baseExpenses:10000})).yearlyData[0]]) assert.ok(r.earlyPenalty>=1000);
});
