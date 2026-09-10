// Presentation-only comparison of the inputs used by the active planning mode.
// Inactive individual/couple settings remain saved but are not explanations of
// changes to the displayed projection.
const LABELS = {
  mode: 'Planning mode', primary: 'Primary', spouse: 'Spouse', shared: 'Household',
  currentAge: 'Current age', retirementAge: 'Retirement age', planThroughAge: 'Plan through age',
  projectionStartYear: 'Projection start year', filingStatus: 'Tax filing status',
  balanceCash: 'Cash balance', balanceTaxable: 'Taxable brokerage balance', balance401k: 'Traditional employer-plan balance',
  balanceTradIra: 'Traditional IRA balance', balanceRoth: 'Roth IRA balance', balanceHsa: 'HSA balance',
  balanceRoth401k: 'Roth employer-plan balance', balanceInherited: 'Inherited account balance',
  rothBasis: 'Roth IRA contribution basis', roth401kBasis: 'Roth employer-plan basis',
  rothFirstContributionYear: 'First Roth IRA contribution year', roth401kFirstYear: 'First Roth employer-plan contribution year',
  preReturn: 'Return before retirement', postReturn: 'Return after retirement', cashReturn: 'Cash return',
  inflation: 'Inflation', portfolioVolatility: 'Annual return volatility', taxableBasisPct: 'Taxable account basis percentage',
  taxableAnnualTaxDrag: 'Annual taxable account tax drag', taxableOrdinaryYield: 'Taxable ordinary-income yield',
  baseExpenses: 'Annual non-healthcare spending', healthcarePre65: 'Annual healthcare before age 65',
  healthcarePost65: 'Annual healthcare from age 65', salaryIncome: 'Annual salary',
  partTimeIncome: 'Annual part-time income', partTimeYears: 'Years of part-time income',
  ssIncome: 'Annual Social Security at full retirement age', ssAge: 'Social Security claiming age',
  ssBirthMonth: 'Birth month for Social Security', ssClaimMonth: 'Social Security claim month',
  ssMonthlyEarnings: 'Monthly earnings history', ssPriorWithheldMonths: 'Social Security benefit months previously withheld',
  pensionIncome: 'Annual pension', pensionStartAge: 'Pension start age', pensionCola: 'Pension cost-of-living adjustment',
  pensionNyExempt: 'Pension exempt from New York tax', rmdStartAge: 'Required distribution start age',
  contrib401k: 'Annual employer-plan contribution', contribMatch: 'Annual employer match', contribHsa: 'Annual HSA contribution',
  conversionBridge: 'Annual Roth conversion from retirement through age 59', conversionMid: 'Annual Roth conversion ages 60–64',
  conversionFinal: 'Annual Roth conversion from age 65 until Social Security', rothConversions: 'Roth conversion history',
  historicalMagi: 'Historical MAGI', irmaaApprovedMagi: 'Approved IRMAA MAGI',
  hsaCoverage: 'HSA coverage', hsaEligibleMonths: 'HSA eligible months', hsaPayroll: 'HSA contributions through Section 125 payroll',
  hsaQualifiedExpenses: 'Qualified HSA expenses', hsaQualifiedPremiums: 'Qualified HSA premiums', hsaPremiumType: 'HSA premium type',
  medicareStartYear: 'Medicare start year', medicareStartMonth: 'Medicare start month',
  priorEmployerWages: 'Prior-year employer wages', rothCatchupAvailable: 'Employer plan accepts Roth catch-ups',
  currentEmployerPlan: 'Traditional employer balance is in the current employer plan', fivePercentOwner: 'More-than-5% business owner',
  acaEligible: 'ACA eligibility confirmed', acaAnnualPremium: 'Annual ACA premium', acaBenchmarkPremium: 'Annual ACA benchmark premium',
  acaCoverageMonths: 'ACA coverage months', useAcaSubsidyEstimate: 'Estimate ACA subsidy', householdSize: 'Household size',
  cashStrategy: 'Cash withdrawal strategy', cashReserveFloor: 'Cash reserve floor', allowReserveAsLastResort: 'Allow spending the cash reserve as a last resort',
  flexibleSpending: 'Flexible spending', creditCardDebt: 'Credit card debt',
  pensionSurvivorFraction: 'Survivor pension percentage', survivorSsAnnual: 'Annual survivor Social Security',
  survivorBaseExpenses: 'Annual survivor spending', spouseInheritance: 'Spousal account election',
  qualifyingSurvivingSpouse: 'Qualifying surviving spouse requirements met',
  useSepp: 'Use SEPP withdrawals', seppRate: 'SEPP interest rate', seppAccountAmount: 'SEPP account amount',
  seppAnnualPayment: 'Annual SEPP payment', seppFirstYearProrate: 'Prorate first-year SEPP payment',
  seppRecaptureTax: 'SEPP recapture tax', seppRecaptureInterest: 'SEPP recapture interest',
  inheritedBasis: 'Inherited account basis', inheritedNyEligible: 'Inherited distribution eligible for New York exclusion',
  inheritedPartialWithdrawalMinimum: 'Inherited account partial withdrawal minimum',
  amount: 'Amount', taxableAmount: 'Taxable amount', year: 'Year', name: 'Name', employerPlanLabel: 'Employer plan type',
};
const PERCENT_FIELDS = new Set(['preReturn','postReturn','cashReturn','inflation','portfolioVolatility','taxableBasisPct','taxableAnnualTaxDrag','taxableOrdinaryYield','pensionCola','pensionSurvivorFraction','seppRate']);
const MONEY_FIELDS = new Set(['rothBasis','roth401kBasis','inheritedBasis','creditCardDebt','baseExpenses','healthcarePre65','healthcarePost65','priorEmployerWages','cashReserveFloor','hsaQualifiedExpenses','hsaQualifiedPremiums','acaAnnualPremium','acaBenchmarkPremium','seppAccountAmount','seppAnnualPayment','seppRecaptureTax','seppRecaptureInterest','survivorSsAnnual','survivorBaseExpenses','inheritedPartialWithdrawalMinimum','amount','taxableAmount']);
const ENUMS = {
  single: 'Individual', couple: 'Married couple', mfj: 'Married filing jointly', unknown: 'Unconfirmed',
  cashFirst: 'Cash first', preserveReserve: 'Preserve cash reserve', proportional: 'Proportional withdrawals', cashLast: 'Cash last',
  self: 'Self-only', family: 'Family', none: 'None', own: 'Treat as own accounts',
  qualified: 'Qualified retirement account', nonqualified: 'Nonqualified annuity', lifeExpectancy: 'Life expectancy',
  tenYear: 'Ten-year rule', spouse: 'Surviving spouse', nonSpouse: 'Non-spouse beneficiary',
  '401k': '401(k)', '403b': '403(b)', ira: 'IRA', '403bTsa': '403(b) tax-sheltered annuity',
  qualifiedOther: 'Other qualified plan', nonqualifiedAnnuity: 'Nonqualified annuity',
  bcoNoCharge: 'BCO withdrawal charges waived', standardContract: 'Standard contract charges',
  ownerAge: 'Deceased owner’s age', explicitYear: 'Specified year', auto: 'Automatic', beforeRbd: 'Before required beginning date', onOrAfterRbd: 'On or after required beginning date',
};
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 });
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 20 });
function words(key) {
  return (LABELS[key] || key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replaceAll('_', ' '))
    .replace(/\bIra\b/g, 'IRA').replace(/\bHsa\b/g, 'HSA').replace(/\bSepp\b/g, 'SEPP')
    .replace(/\bRmd\b/g, 'RMD').replace(/\bNy\b/g, 'New York').replace(/^./, char => char.toUpperCase());
}
function valueText(value, path) {
  if (value === undefined) return 'Not entered';
  if (value === null) return 'Unconfirmed';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    const key = path.at(-1);
    if (PERCENT_FIELDS.has(key)) return `${number.format(Number((value * 100).toPrecision(15)))}%`;
    if (MONEY_FIELDS.has(key) || /^(balance|contrib|conversion)/.test(key) || /Income$/.test(key) || path.some(key => ['historicalMagi','irmaaApprovedMagi','ssMonthlyEarnings'].includes(key))) return currency.format(value);
    // Ages and calendar years should never acquire a thousands separator.
    if (/year|age|month/i.test(key)) return String(value);
    return number.format(value);
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    return entries.length ? entries.map(([key, item]) => `${words(key)}: ${valueText(item, [...path,key])}`).join('; ') : 'No entries';
  }
  if (value === '') return 'Not entered';
  if (path.at(-1) === 'filingStatus' && value === 'single') return 'Single filer';
  return ENUMS[value] || String(value);
}
function activeInputs(inputs) {
  if (inputs.mode === 'couple') return { mode: 'couple', couple: inputs.couple };
  return Object.fromEntries(Object.entries({ ...inputs, mode: 'single' }).filter(([key]) => key !== 'couple' && key !== 'scenarioVersion'));
}
function labelFor(path) {
  return path.filter(key => key !== 'couple').map((key, index, parts) => {
    if (/^\d+$/.test(key)) return parts[index - 1] === 'rothConversions' ? `Entry ${Number(key) + 1}` : key;
    return words(key);
  }).join(' · ');
}

export function baselineChanges(beforeInputs, afterInputs) {
  const changes = [];
  function visit(before, after, path = []) {
    if (Object.is(before, after)) return;
    const beforeObject = before !== null && typeof before === 'object';
    const afterObject = after !== null && typeof after === 'object';
    if ((beforeObject || before === undefined) && (afterObject || after === undefined)) {
      const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].filter(key => key !== 'scenarioVersion');
      if (keys.length) {
        for (const key of keys) visit(before?.[key], after?.[key], [...path, key]);
        return;
      }
      if (beforeObject && afterObject) return;
    }
    changes.push({ path: path.join('.'), label: labelFor(path), before: valueText(before, path), after: valueText(after, path) });
  }
  visit(activeInputs(beforeInputs), activeInputs(afterInputs));
  return changes.sort((a, b) => Number(b.path === 'mode') - Number(a.path === 'mode'));
}
