// These mappings route existing engine notices; they do not decide validity or
// reproduce eligibility rules. Unrecognized notices remain visible and actionable.
const rules = [
  ['Prior-employer plan separation', ['currentEmployerPlan'], 'Early-distribution penalties', 'Review employer plan'],
  ['Roth opening tax year', ['rothFirstContributionYear'], 'Roth withdrawal taxes', 'Enter Roth opening year'],
  ['Employer Roth opening year', ['roth401kFirstYear'], 'Employer Roth withdrawal taxes', 'Enter employer Roth year'],
  ['Prior-year employer wages', ['priorEmployerWages', 'rothCatchupAvailable'], 'Catch-up contributions', 'Review employer wages'],
  ['HSA coverage is unknown', ['hsaCoverage'], 'Credited HSA contributions', 'Confirm HSA coverage'],
  ['Healthcare costs have not been classified', ['hsaQualifiedExpenses', 'hsaQualifiedPremiums', 'hsaPremiumType'], 'Tax-free HSA reimbursements', 'Classify healthcare costs'],
  ['SEPP account allocation', ['birthDate', 'seppStartDate', 'seppAccountAmount'], 'Early-withdrawal exemption', 'Review SEPP setup'],
  ['An existing SEPP requires', ['seppAnnualPayment'], 'Existing SEPP payment schedule', 'Enter established payment'],
  ['SEPP modification recapture', ['seppRecaptureTax', 'seppRecaptureInterest'], 'Historical recapture costs', 'Review recapture costs'],
  ['Survivor scenario requires', ['spouseInheritance'], 'Survivor account transfers', 'Review survivor election'],
  ['Pension survivor election', ['pensionSurvivorFraction'], 'Survivor pension income', 'Enter pension continuation'],
  ['Death-year SEPP timing', ['seppStartDate', 'deathYear'], 'Death-year distributions', 'Review SEPP timing'],
  ['Enter the SSA survivor', ['survivorSsAnnual'], 'Survivor Social Security income', 'Enter survivor benefit'],
  ['Death before retirement', ['deathYear'], 'Pre-retirement survivor projection', 'Review death scenario'],
  ['Social Security earnings-test timing', ['ssMonthlyEarnings'], 'Social Security earnings-test timing', 'Enter monthly wages'],
  ['IRMAA lookback MAGI', ['historicalMagi'], 'Medicare income surcharges', 'Enter historical MAGI', 'shared'],
  ['ACA eligibility and actual/benchmark', ['acaEligible', 'acaAnnualPremium', 'acaBenchmarkPremium'], 'Marketplace premium credit', 'Review marketplace coverage', 'shared'],
  ['Survivor lifestyle spending', ['survivorBaseExpenses'], 'Survivor spending budget', 'Enter survivor spending', 'shared'],
];

export function buildReviewItems(notices = [], inputs = {}) {
  const couple = inputs.mode === 'couple';
  const people = couple ? ['primary', 'spouse'].map(owner => ({
    owner, prefix: `${inputs.couple?.[owner]?.name || (owner === 'primary' ? 'Primary' : 'Spouse')}: `,
  })) : [{ owner: 'individual', prefix: '' }];
  return notices.map((message, index) => {
    const year = /^(\d{4}): /.exec(message);
    if (year) return { id: `review-${index}`, message, year: Number(year[1]), targets: [], impact: 'This year’s calculation', action: 'Inspect year' };
    const rule = rules.find(([prefix]) => message.startsWith(prefix) || people.some(person => message.startsWith(person.prefix + prefix)));
    if (!rule) return { id: `review-${index}`, message, targets: [], impact: 'Projection assumptions', action: 'Review financial details' };
    const [prefix, fields, impact, action, scope] = rule;
    const owners = scope === 'shared' ? [couple ? 'shared' : 'individual']
      : people.filter(person => message.startsWith(person.prefix + prefix)).map(person => person.owner);
    return { id: `review-${index}`, message, impact, action, targets: owners.map(owner => ({ owner, fields })) };
  });
}

export function fieldReviews(items, owner, key) {
  return items.filter(item => item.targets.some(target => target.owner === owner && target.fields.includes(key)));
}
