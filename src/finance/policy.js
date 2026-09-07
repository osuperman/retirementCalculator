// Explicit eligibility inputs. Unknown facts are not affirmative eligibility.
export const POLICY_DEFAULTS = {
  scenarioVersion: 2,
  projectionStartYear: null,
  rothFirstContributionYear: null,
  rothConversions: [],
  hsaCoverage: 'unknown',
  hsaEligibleMonths: 12,
  medicareStartYear: null,
  medicareStartMonth: 1,
  hsaPayroll: false,
  hsaQualifiedExpenses: 0,
  hsaQualifiedPremiums: 0,
  hsaPremiumType: 'none',
  acaEligible: false,
  acaAnnualPremium: 0,
  acaBenchmarkPremium: 0,
  acaCoverageMonths: 12,
  historicalMagi: {},
  irmaaApprovedMagi: {},
  priorEmployerWages: null,
  rothCatchupAvailable: false,
  balanceRoth401k: 0,
  roth401kBasis: 0,
  roth401kFirstYear: null,
  ssBirthMonth: 1,
  ssClaimMonth: 1,
  ssMonthlyEarnings: {},
  ssPriorWithheldMonths: null,
  currentEmployerPlan: true,
  fivePercentOwner: false,
  taxableOrdinaryYield: 0,
  deathYear: null,
  deathMonth: 12,
  spouseInheritance: 'unknown',
  pensionSurvivorFraction: null,
  survivorSsAnnual: null,
  survivorBaseExpenses: null,
  qualifyingSurvivingSpouse: false,
  seppAccountAmount: 0,
  seppStartDate: '',
  birthDate: '',
  seppAnnualPayment: null,
  seppFirstYearProrate: false,
  seppModificationYear: null,
  seppRecaptureTax: null,
  seppRecaptureInterest: null,
  inheritedNyEligible: false,
};

export function validateFinancialFacts(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid financial inputs');
  for (const [key,fallback] of Object.entries(POLICY_DEFAULTS)) {
    const value=raw[key];
    if (value === undefined) continue;
    if (fallback === null) {
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error(`Invalid ${key}`);
    } else if (Array.isArray(fallback)) {
      if (!Array.isArray(value)) throw new Error(`Invalid ${key}`);
    } else if (typeof fallback === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${key}`);
      for (const entry of Object.values(value)) {
        const amounts=key==='ssMonthlyEarnings' ? entry : [entry];
        if (!Array.isArray(amounts) || (key==='ssMonthlyEarnings' && amounts.length!==12) || amounts.some(n=>typeof n!=='number' || !Number.isFinite(n) || n<0)) throw new Error(`Invalid ${key}`);
      }
    } else if (typeof value !== typeof fallback || (typeof value==='number' && (!Number.isFinite(value) || value<0))) throw new Error(`Invalid ${key}`);
  }
  for (const v of raw.rothConversions || []) {
    if (!v || !Number.isInteger(v.year) || v.year<1998 || !Number.isFinite(v.amount) || v.amount<0 || (v.taxableAmount!=null && (!Number.isFinite(v.taxableAmount) || v.taxableAmount<0 || v.taxableAmount>v.amount))) throw new Error('Invalid Roth conversion history');
  }
}

export function employerPlanRmd(person,age,year,balance,divisor) {
  return age >= person.rmdStartAge && (age >= person.retirementAge || person.currentEmployerPlan===false || person.fivePercentOwner===true) ? balance/divisor(age) : 0;
}

export function seppSchedule(person,year,state,paymentFor) {
  const start = new Date(`${person.seppStartDate}T00:00:00Z`);
  const birth = new Date(`${person.birthDate}T00:00:00Z`);
  if (!person.useSepp || !Number.isFinite(+start) || !Number.isFinite(+birth) || !(person.seppAccountAmount>0)) return {payment:0,release:0,recapture:0};
  const five = new Date(start);five.setUTCFullYear(five.getUTCFullYear()+5);
  const age595 = new Date(birth);age595.setUTCMonth(age595.getUTCMonth()+714);
  const end = new Date(Math.max(+five,+age595));
  if (!state.initialized && year>=start.getUTCFullYear()) {
    state.initialized = true;
    state.balance = Math.min(person.seppAccountAmount,state.available);
    state.allocation = state.balance;
    const startAge = (start-birth)/31557600000;
    state.payment = person.seppAnnualPayment ?? paymentFor(state.balance,person.seppRate ?? .05,Math.floor(startAge));
  }
  if (!state.initialized) return {payment:0,release:0,recapture:0};
  if (year > end.getUTCFullYear() || (person.deathYear != null && year>person.deathYear) || (person.seppModificationYear != null && year>=person.seppModificationYear)) {
    const release = state.balance;state.balance=0;
    return {payment:0,release,recapture:year===person.seppModificationYear ? Math.max(0,person.seppRecaptureTax || 0)+Math.max(0,person.seppRecaptureInterest || 0) : 0};
  }
  const fraction = Math.min(aliveFraction(person,year),year===start.getUTCFullYear() && person.seppFirstYearProrate ? (12-start.getUTCMonth())/12 : 1);
  const payment = Math.min(state.balance,state.payment*fraction);
  state.balance -= payment;
  return {payment,release:0,recapture:0};
}

export function aliveFraction(person,year,ss=false) {
  if (person.deathYear == null || year < person.deathYear) return 1;
  if (year > person.deathYear) return 0;
  return Math.max(0,Math.min(12,(person.deathMonth ?? 12)-(ss ? 1 : 0)))/12;
}

export function transferSpousalAccounts(from,to,fromRoth,toRoth,fromPlan,toPlan) {
  to.bTradIra += from.bTradIra + from.b401k;
  from.bTradIra = 0; from.b401k = 0;
  for (const key of ['bRoth','bHsa']) {to[key]+=from[key];from[key]=0;}
  toRoth.contribBasis += fromRoth.contribBasis; fromRoth.contribBasis=0;
  toRoth.vintages.push(...fromRoth.vintages);fromRoth.vintages=[];
  toRoth.vintages.sort((a,b)=>a.year-b.year);
  toRoth.firstYear = [toRoth.firstYear,fromRoth.firstYear].filter(y=>y!=null).sort((a,b)=>a-b)[0] ?? null;
  toPlan.balance += fromPlan.balance; toPlan.basis += fromPlan.basis;
  toPlan.firstYear = [toPlan.firstYear,fromPlan.firstYear].filter(y=>y!=null).sort((a,b)=>a-b)[0] ?? null;
  fromPlan.balance=0;fromPlan.basis=0;
}

export function financialNotices(inputs,rows=[]) {
  const couple = inputs.mode === 'couple';
  const people = couple ? [inputs.couple.primary,inputs.couple.spouse] : [inputs];
  const shared = couple ? inputs.couple.shared : inputs;
  const startYear=shared.projectionStartYear ?? new Date().getFullYear();
  const notices=[];
  const add = message => {if(!notices.includes(message))notices.push(message);};
  for (const [i,p] of people.entries()) {
    const owner = couple ? `${p.name || (i===0?'Primary':'Spouse')}: ` : '';
    if (p.currentEmployerPlan===false && p.balance401k>0 && p.currentAge<60) add(owner+'Prior-employer plan separation age is not modeled; early distributions conservatively retain the 10% additional tax.');
    if (p.balanceRoth>0 && p.rothFirstContributionYear == null) add(owner+'Roth opening tax year is missing; earnings are treated as unqualified.');
    if (p.balanceRoth401k>0 && p.roth401kFirstYear == null) add(owner+'Employer Roth opening year is missing; distributions may be taxable.');
    if (p.contrib401k>24500 && p.currentAge>=50 && p.priorEmployerWages == null) add(owner+'Prior-year employer wages are missing; mandatory Roth catch-up eligibility needs confirmation.');
    if (p.contribHsa>0 && p.hsaCoverage==='unknown') add(owner+'HSA coverage is unknown; no new HSA contributions are credited.');
    if (p.balanceHsa>0 && (p.healthcarePre65>0 || p.healthcarePost65>0) && !(p.hsaQualifiedExpenses>0 || p.hsaQualifiedPremiums>0)) add(owner+'Healthcare costs have not been classified for HSA reimbursement; no tax-free reimbursement is assumed.');
    if (p.useSepp && (!p.birthDate || !p.seppStartDate || !(p.seppAccountAmount>0))) add(owner+'SEPP account allocation, birth date, and start date are required; no exemption is assumed.');
    if (p.useSepp && p.seppStartDate && Number(p.seppStartDate.slice(0,4))<startYear && p.seppAnnualPayment == null) add(owner+'An existing SEPP requires its established annual payment and confirmation of compliance history.');
    if (p.seppModificationYear != null && (p.seppRecaptureTax == null || p.seppRecaptureInterest == null)) add(owner+'SEPP modification recapture tax and interest are missing.');
    if (p.deathYear != null) {
      if (p.spouseInheritance!=='own') add(owner+'Survivor scenario requires the spousal own-account transfer election; beneficiary retention is not yet supported.');
      if (p.pensionIncome>0 && p.pensionSurvivorFraction==null) add(owner+'Pension survivor election is missing; continuation is set to zero.');
      if (p.useSepp) add(owner+'Death-year SEPP timing and beneficiary distribution transition require review.');
    }
    if (people.some(x=>x.deathYear!=null) && p.survivorSsAnnual==null && people.some(x=>x.ssIncome>0)) add(owner+'Enter the SSA survivor benefit estimate; the fallback higher-benefit calculation is an approximation.');
    if (p.deathYear != null && p.deathYear<startYear+p.retirementAge-p.currentAge) add(owner+'Death before retirement requires separate review of pre-retirement household spending and survivor pension eligibility.');
    if (p.currentAge<=66 && p.ssIncome>0 && (p.salaryIncome>0 || p.partTimeIncome>0) && !Object.keys(p.ssMonthlyEarnings || {}).length) add(owner+'Social Security earnings-test timing uses evenly spread annual wages; enter monthly wages for first-year or FRA-year precision.');
    if (p.currentAge>=65 && (![startYear-2,startYear-1].every(y=>shared.historicalMagi?.[y]!=null))) add(owner+'IRMAA lookback MAGI is missing for one or both pre-projection years; missing assessments use current-year income as an estimate.');
  }
  if (shared.useAcaSubsidyEstimate && (!shared.acaEligible || !(shared.acaAnnualPremium>0 && shared.acaBenchmarkPremium>0))) add('ACA eligibility and actual/benchmark premiums must be confirmed; no premium credit is assumed for missing inputs.');
  if (people.some(p=>p.deathYear!=null) && shared.survivorBaseExpenses==null) add('Survivor lifestyle spending is missing; the full household budget continues.');
  for (const row of rows) if(row.calculationNotice)add(`${row.year}: ${row.calculationNotice}`);
  return notices;
}

export function catchupSplit(person, age, year, applied, inflation) {
  const base = 24500*Math.pow(1+inflation,year-2026);
  const mandatory = year >= 2026 && age >= 50 && (person.priorEmployerWages ?? 0) > 150000*Math.pow(1+inflation,Math.max(0,year-2026));
  const roth = mandatory ? Math.max(0,applied-base) : 0;
  return {pretax:applied-roth,roth:person.rothCatchupAvailable ? roth : 0,disallowed:person.rothCatchupAvailable ? 0 : roth};
}

export function planRothEarnings(amount, account, age, year) {
  if (!account || amount <= 0) return 0;
  if (age >= 59.5 && account.firstYear != null && year-account.firstYear>=5) return 0;
  return amount*Math.max(0,1-account.basis/Math.max(1,account.balance));
}

export function initialRothLayers(person) {
  const balance = Math.max(0, person.balanceRoth || 0);
  const contribBasis = Math.min(balance, Math.max(0, person.rothBasis || 0));
  let room = balance - contribBasis;
  const vintages = (person.rothConversions || []).map(v => ({
    year: Number(v.year), amount: Math.max(0, Number(v.amount) || 0),
    taxableAmount: Math.max(0, Number(v.taxableAmount ?? v.amount) || 0),
  })).sort((a,b) => a.year-b.year).map(v => {
    const amount = Math.min(room, v.amount); room -= amount;
    return {...v, amount, taxableAmount: Math.min(amount, v.taxableAmount)};
  });
  const grouped=[];
  for (const v of vintages) {
    const previous=grouped.find(x=>x.year===v.year);
    if(previous) {previous.amount+=v.amount;previous.taxableAmount+=v.taxableAmount;}
    else grouped.push(v);
  }
  return {contribBasis, vintages:grouped, firstYear: person.rothFirstContributionYear, knownEmpty: balance===0};
}

export function rothQualified(age, year, layers) {
  return age >= 59.5 && layers?.firstYear != null && year - layers.firstYear >= 5;
}

export function hsaEligibleFraction(person, age, year) {
  if (!['self','family'].includes(person.hsaCoverage)) return 0;
  let months = Math.max(0, Math.min(12, person.hsaEligibleMonths ?? 12));
  const medicareYear = person.medicareStartYear ?? (year + Math.max(0,65-age));
  if (year > medicareYear) return 0;
  if (year === medicareYear) months = Math.min(months, (person.medicareStartMonth ?? 1)-1);
  return months/12;
}

export function coupleHsaRooms(primary,spouse,pAge,sAge,year,selfBase,familyBase,primaryApplied=0) {
  const p=hsaEligibleFraction(primary,pAge,year),s=hsaEligibleFraction(spouse,sAge,year);
  const family=Math.max(primary.hsaCoverage==='family'?p:0,spouse.hsaCoverage==='family'?s:0);
  const pool=familyBase*family+selfBase*(Math.max(0,p-family)+Math.max(0,s-family));
  const pCatch=pAge>=55?1000*p:0,sCatch=sAge>=55?1000*s:0;
  const pBase=familyBase*Math.min(p,family)+selfBase*Math.max(0,p-family);
  const sBase=familyBase*Math.min(s,family)+selfBase*Math.max(0,s-family);
  return {primary:pBase+pCatch,spouse:Math.min(sBase,Math.max(0,pool-Math.max(0,primaryApplied-pCatch)))+sCatch};
}

export function qualifiedHsaExpenses(person, age, inflMult, totalHealthcare) {
  const premiumsAllowed = ['cobra','unemployment'].includes(person.hsaPremiumType) ||
    (person.hsaPremiumType === 'medicare' && age >= 65);
  return Math.min(Math.max(0,totalHealthcare), Math.max(0,
    (Number(person.hsaQualifiedExpenses || 0) + (premiumsAllowed ? Number(person.hsaQualifiedPremiums || 0) : 0))*inflMult));
}

export function coupleQualifiedHsa(primaryBalance,spouseBalance,primary,spouse,primaryAge,spouseAge,inflMult,totalHealthcare) {
  const medical=Math.max(0,(primary.hsaQualifiedExpenses || 0)+(spouse.hsaQualifiedExpenses || 0))*inflMult;
  const premium = (p,ownerAge) => (['cobra','unemployment'].includes(p.hsaPremiumType) || (p.hsaPremiumType==='medicare' && ownerAge>=65)) ? Math.max(0,p.hsaQualifiedPremiums || 0)*inflMult : 0;
  const total = Math.min(totalHealthcare,medical+premium(primary,primaryAge)+premium(spouse,spouseAge));
  const primaryCap=medical+premium(primary,primaryAge)+premium(spouse,primaryAge);
  const pDraw=Math.min(primaryBalance,primaryCap,total);
  const spouseCap=medical+premium(primary,spouseAge)+premium(spouse,spouseAge);
  const sDraw=Math.min(spouseBalance,spouseCap,Math.max(0,total-pDraw));
  return {primary:pDraw,spouse:sDraw,total:pDraw+sDraw};
}

export function historicalMagi(person) {
  return {...(person.historicalMagi || {})};
}

export function distributionYears(inputs, startYear) {
  const people = inputs.mode === 'couple' ? [inputs.couple.primary,inputs.couple.spouse] : [inputs];
  const first = Math.max(startYear,Math.min(...people.map(p => startYear+p.retirementAge-p.currentAge)));
  const last = Math.max(...people.map(p => startYear+p.planThroughAge-p.currentAge));
  return Math.max(0,last-first+1);
}

export function annualReturn(returns,index,fallback) {
  if (returns == null) return fallback;
  if (!Number.isFinite(returns[index])) throw new RangeError(`Missing investment return for distribution year ${index+1}`);
  return Math.max(-1,returns[index]);
}

// Ages are the ages attained during the calendar year; monthly earnings may
// override the annual equal-month allocation in the FRA/first benefit year.
export function socialSecurityPaid(person, age, year, fra, entitlement, wages, inflation, history) {
  if (entitlement <= 0) return {paid:0,withheld:0,entitlement:0};
  const claimAge = Math.max(62,Math.min(70,person.ssAge ?? 67));
  const birthMonth = Math.max(1,Math.min(12,person.ssBirthMonth ?? 1));
  const fraTotalMonths = Math.round(fra*12)+birthMonth-1;
  const fraAge = Math.floor(fraTotalMonths/12);
  const fraMonth = fraTotalMonths%12+1;
  const beforeFraMonths = age < fraAge ? 12 : age === fraAge ? fraMonth-1 : 0;
  const firstMonth = age === claimAge ? Math.max(1,Math.min(12,person.ssClaimMonth ?? 1)) : 1;
  const claimedMonths = 13-firstMonth;
  const reduction = months => 1-Math.min(36,months)*5/900-Math.max(0,months-36)*5/1200;
  const earlyMonths = Math.max(0,Math.round((fra-claimAge)*12));
  const monthly = entitlement/12;
  const annual = monthly*claimedMonths;
  const indexed = Math.pow(1+inflation,year-2026);
  const limit = (age === fraAge ? 65160 : 24480)*indexed;
  const supplied = person.ssMonthlyEarnings?.[year];
  const earnings = Array.isArray(supplied) && supplied.length === 12 ? supplied : Array(12).fill(wages/12);
  const coveredWages = age === fraAge ? earnings.slice(0,beforeFraMonths).reduce((a,b)=>a+b,0) : wages;
  let withheld = beforeFraMonths > 0 ? Math.min(monthly*Math.max(0,beforeFraMonths-firstMonth+1),Math.max(0,coveredWages-limit)/(age === fraAge ? 3 : 2)) : 0;
  if (age === claimAge && Array.isArray(supplied)) {
    // Special first-year rule pays each wholly retired month regardless of
    // wages before retirement. Inputs here are covered W-2 wages only.
    const payable = earnings.slice(firstMonth-1).reduce((sum,w,i)=>sum+((firstMonth+i)>beforeFraMonths || w<=limit/12 ? monthly : 0),0);
    withheld = Math.min(withheld,Math.max(0,annual-payable));
  }
  history.withheldMonths += monthly > 0 ? Math.min(claimedMonths,Math.ceil(withheld/monthly)) : 0;
  const adjustment = age >= fraAge && earlyMonths > 0 ? reduction(Math.max(0,earlyMonths-history.withheldMonths))/reduction(earlyMonths) : 1;
  const postFraClaimedMonths = age>=fraAge ? Math.max(0,13-Math.max(firstMonth,beforeFraMonths+1)) : 0;
  const adjustedAnnual = annual+postFraClaimedMonths*monthly*(adjustment-1);
  return {paid:Math.max(0,adjustedAnnual-withheld),withheld,entitlement:adjustedAnnual};
}
