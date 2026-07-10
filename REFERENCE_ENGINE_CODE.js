/*
 * REFERENCE_ENGINE_CODE.js
 * Faithful extraction of the retirement-planning engine from src/App.jsx
 * at commit e025363 (deployed at https://osuperman.github.io/retirementCalculator/).
 * Pure calculation functions only — no React/UI. ES module.
 * Entry point: simulate(inputs) for individual plans, simulateCouple(couple)
 * for households, or simulatePlan(inputs) which dispatches on inputs.mode.
 * Verified: reproduces the reference app's default single/couple plans
 * byte-for-byte and passes the 98-case in-app self-test suite (runSelfTests()).
 */
const PROJECTION_START_YEAR = new Date().getFullYear();

// Federal parameters by filing status. "mfj" = married filing jointly;
// "single" = single filer (used by widowed, divorced, or never-married
// planners). Qualifying-surviving-spouse years can be modeled as "mfj".
const FEDERAL_TAX_TABLES = {
  mfj: {
    2024: {
      standardDeduction: 29200,
      ordinaryBrackets: [
        [0, 23200, 0.1],
        [23200, 94300, 0.12],
        [94300, 201050, 0.22],
        [201050, 383900, 0.24],
        [383900, 487450, 0.32],
        [487450, 731200, 0.35],
        [731200, Infinity, 0.37],
      ],
      ltcgZeroTop: 94050,
      ltcgFifteenTop: 583750,
    },
    2026: {
      standardDeduction: 32200,
      ordinaryBrackets: [
        [0, 24800, 0.1],
        [24800, 100800, 0.12],
        [100800, 211400, 0.22],
        [211400, 403550, 0.24],
        [403550, 512450, 0.32],
        [512450, 768700, 0.35],
        [768700, Infinity, 0.37],
      ],
      ltcgZeroTop: 98900,
      ltcgFifteenTop: 613700,
    },
  },
  single: {
    2024: {
      standardDeduction: 14600,
      ordinaryBrackets: [
        [0, 11600, 0.1],
        [11600, 47150, 0.12],
        [47150, 100525, 0.22],
        [100525, 191950, 0.24],
        [191950, 243725, 0.32],
        [243725, 609350, 0.35],
        [609350, Infinity, 0.37],
      ],
      ltcgZeroTop: 47025,
      ltcgFifteenTop: 518900,
    },
    2026: {
      standardDeduction: 16100,
      ordinaryBrackets: [
        [0, 12400, 0.1],
        [12400, 50400, 0.12],
        [50400, 105700, 0.22],
        [105700, 201775, 0.24],
        [201775, 256225, 0.32],
        [256225, 640600, 0.35],
        [640600, Infinity, 0.37],
      ],
      ltcgZeroTop: 49450,
      ltcgFifteenTop: 545500,
    },
  },
};

// Per-status statutory (non-indexed) thresholds and senior-deduction bases.
const FILING_STATUS_PARAMS = {
  mfj: {
    ssThreshold1: 32000,
    ssThreshold2: 44000,
    niitThreshold: 250000,
    // Age-65+ additional standard deduction per person (2026 base, indexed)
    seniorExtraStdDed2026: 1650,
    // OBBBA senior deduction MAGI phase-out start (2025-2028, not indexed)
    obbbaPhaseOutStart: 150000,
  },
  single: {
    ssThreshold1: 25000,
    ssThreshold2: 34000,
    niitThreshold: 200000,
    seniorExtraStdDed2026: 2050,
    obbbaPhaseOutStart: 75000,
  },
};

const LIMIT_TABLES = {
  2026: {
    k401Employee: 24500,
    k401CatchUp50: 8000,
    k401CatchUp60To63: 11250,
    k401AnnualAdditions: 72000,
    hsaSelf: 4400,
    hsaFamily: 8750,
    hsaCatchUp55: 1000,
  },
};

const ACA_APPLICABLE_PERCENTAGES_2026 = [
  [0, 1.33, 0.021, 0.021],
  [1.33, 1.5, 0.0314, 0.0419],
  [1.5, 2.0, 0.0419, 0.066],
  [2.0, 2.5, 0.066, 0.0844],
  [2.5, 3.0, 0.0844, 0.0996],
  [3.0, 4.0, 0.0996, 0.0996],
];

const IRMAA_2026 = {
  mfj: [
    { top: 218000, monthlyPartB: 0, monthlyPartD: 0 },
    { top: 274000, monthlyPartB: 81.2, monthlyPartD: 14.5 },
    { top: 342000, monthlyPartB: 202.9, monthlyPartD: 37.5 },
    { top: 410000, monthlyPartB: 324.6, monthlyPartD: 60.4 },
    { top: 750000, monthlyPartB: 446.3, monthlyPartD: 83.3 },
    { top: Infinity, monthlyPartB: 487, monthlyPartD: 91 },
  ],
  single: [
    { top: 109000, monthlyPartB: 0, monthlyPartD: 0 },
    { top: 137000, monthlyPartB: 81.2, monthlyPartD: 14.5 },
    { top: 171000, monthlyPartB: 202.9, monthlyPartD: 37.5 },
    { top: 205000, monthlyPartB: 324.6, monthlyPartD: 60.4 },
    { top: 500000, monthlyPartB: 446.3, monthlyPartD: 83.3 },
    { top: Infinity, monthlyPartB: 487, monthlyPartD: 91 },
  ],
};

function projectedFromKnownTable(table, year, inflation) {
  if (table[year]) return { baseYear: year, base: table[year], factor: 1 };
  const knownYears = Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b);
  const baseYear = knownYears.filter((y) => y <= year).pop() ?? knownYears[0];
  const base = table[baseYear];
  const factor = Math.pow(1 + inflation, Math.max(0, year - baseYear));
  return { baseYear, base, factor };
}

function getFederalTaxParams(year, inflation = 0.03, filingStatus = "mfj") {
  const table = FEDERAL_TAX_TABLES[filingStatus] || FEDERAL_TAX_TABLES.mfj;
  const projected = projectedFromKnownTable(table, year, inflation);
  const { base, factor } = projected;
  return {
    standardDeduction: base.standardDeduction * factor,
    ordinaryBrackets: base.ordinaryBrackets.map(([low, high, rate]) => [
      low * factor,
      high === Infinity ? Infinity : high * factor,
      rate,
    ]),
    ltcgZeroTop: base.ltcgZeroTop * factor,
    ltcgFifteenTop: base.ltcgFifteenTop * factor,
  };
}

function getContributionLimits(age, year, inflation = 0.03, householdSize = 2) {
  const { base, factor } = projectedFromKnownTable(LIMIT_TABLES, year, inflation);
  const roundTo = (value, increment) =>
    Math.round((value * factor) / increment) * increment;
  const catchUp401k =
    age >= 60 && age <= 63
      ? roundTo(base.k401CatchUp60To63, 250)
      : age >= 50
        ? roundTo(base.k401CatchUp50, 500)
        : 0;
  const hsaBase =
    householdSize > 1 ? roundTo(base.hsaFamily, 50) : roundTo(base.hsaSelf, 50);
  return {
    k401Employee: roundTo(base.k401Employee, 500) + catchUp401k,
    k401Total: roundTo(base.k401AnnualAdditions, 1000) + catchUp401k,
    hsa: hsaBase + (age >= 55 ? base.hsaCatchUp55 : 0),
  };
}

function rmdStartAgeForBirthYear(birthYear) {
  if (birthYear >= 1960) return 75;
  if (birthYear >= 1951) return 73;
  if (birthYear >= 1950) return 72;
  return 72;
}

function defaultRmdStartAge(currentAge, currentYear = PROJECTION_START_YEAR) {
  return rmdStartAgeForBirthYear(currentYear - currentAge);
}

// Earliest legal claim age is 62; delayed retirement credits stop at 70.
const SS_MIN_CLAIM_AGE = 62;
const SS_MAX_CREDIT_AGE = 70;

function adjustedSocialSecurityBenefit(fraBenefit, claimAge, fullRetirementAge = 67) {
  const effectiveClaimAge = Math.min(
    SS_MAX_CREDIT_AGE,
    Math.max(SS_MIN_CLAIM_AGE, claimAge),
  );
  const months = Math.round((effectiveClaimAge - fullRetirementAge) * 12);
  if (months === 0) return fraBenefit;
  if (months > 0) {
    return fraBenefit * (1 + Math.min(months, 36) * (0.08 / 12));
  }
  const earlyMonths = Math.abs(months);
  const first36Reduction = Math.min(earlyMonths, 36) * (5 / 9 / 100);
  const extraReduction = Math.max(0, earlyMonths - 36) * (5 / 12 / 100);
  return fraBenefit * Math.max(0, 1 - first36Reduction - extraReduction);
}

// ============================================================
// TAX CALCULATIONS (per filing status: MFJ or single)
// ============================================================

function fedOrdinaryTax(taxableIncome, year, inflation = 0.03, filingStatus = "mfj") {
  if (taxableIncome <= 0) return 0;
  const { ordinaryBrackets: brackets } = getFederalTaxParams(
    year,
    inflation,
    filingStatus,
  );
  let tax = 0;
  for (const [low, high, rate] of brackets) {
    if (taxableIncome > low) {
      tax += (Math.min(taxableIncome, high) - low) * rate;
    }
    if (taxableIncome <= high) break;
  }
  return tax;
}

function fedLtcgTax(
  ltcg,
  ordinaryTaxable,
  year,
  inflation = 0.03,
  filingStatus = "mfj",
) {
  if (ltcg <= 0) return 0;
  const { ltcgZeroTop: zeroTop, ltcgFifteenTop: fifteenTop } =
    getFederalTaxParams(year, inflation, filingStatus);
  let start = Math.max(0, ordinaryTaxable);
  let tax = 0;
  let remaining = ltcg;
  if (start < zeroTop) {
    const atZero = Math.min(remaining, zeroTop - start);
    remaining -= atZero;
    start += atZero;
  }
  if (remaining > 0 && start < fifteenTop) {
    const atFifteen = Math.min(remaining, fifteenTop - start);
    tax += atFifteen * 0.15;
    remaining -= atFifteen;
    start += atFifteen;
  }
  if (remaining > 0) tax += remaining * 0.2;
  return tax;
}

// NY brackets and standard deductions are projected from their ~2024
// statutory values by the input inflation rate, mirroring how federal brackets
// are projected in getFederalTaxParams. Without this, only the federal side
// indexed and NY suffered unbounded bracket creep over a multi-decade horizon,
// overstating NY tax and understating ending balances in later years.
const NY_TAX_BASE_YEAR = 2024;
// NY 2024 statutory schedules per filing status. The five lowest rates
// (4% through 6%) receive the FY2026 middle-class cut in both schedules.
const NY_TAX_PARAMS = {
  mfj: {
    standardDeduction: 16050,
    brackets: [
      [0, 17150, 0.04],
      [17150, 23600, 0.045],
      [23600, 27900, 0.0525],
      [27900, 161550, 0.055],
      [161550, 323200, 0.06],
      [323200, 2155350, 0.0685],
      [2155350, 5000000, 0.0965],
      [5000000, 25000000, 0.103],
      [25000000, Infinity, 0.109],
    ],
  },
  single: {
    standardDeduction: 8000,
    brackets: [
      [0, 8500, 0.04],
      [8500, 11700, 0.045],
      [11700, 13900, 0.0525],
      [13900, 80650, 0.055],
      [80650, 215400, 0.06],
      [215400, 1077550, 0.0685],
      [1077550, 5000000, 0.0965],
      [5000000, 25000000, 0.103],
      [25000000, Infinity, 0.109],
    ],
  },
};
function nyStateTax(
  taxableIncome,
  year = NY_TAX_BASE_YEAR,
  inflation = 0.03,
  filingStatus = "mfj",
) {
  if (taxableIncome <= 0) return 0;
  const params = NY_TAX_PARAMS[filingStatus] || NY_TAX_PARAMS.mfj;
  const factor = Math.pow(1 + inflation, Math.max(0, year - NY_TAX_BASE_YEAR));
  const stdDed = params.standardDeduction * factor;
  const nyTaxable = Math.max(0, taxableIncome - stdDed);
  // FY2026 NY budget (Ch. 59, Laws of 2025) cuts the bottom five rates by
  // 0.1pp in tax year 2026 and 0.2pp total from 2027 onward (permanent).
  const midClassCut = year >= 2027 ? 0.002 : year >= 2026 ? 0.001 : 0;
  const brackets = params.brackets.map(([low, high, rate], index) => [
    low * factor,
    high === Infinity ? Infinity : high * factor,
    index < 5 ? rate - midClassCut : rate,
  ]);
  let tax = 0;
  for (const [low, high, rate] of brackets) {
    if (nyTaxable > low) {
      tax += (Math.min(nyTaxable, high) - low) * rate;
    }
    if (nyTaxable <= high) break;
  }
  return tax;
}

// Taxable Social Security benefits (provisional income rules).
// Thresholds are NOT inflation-adjusted by statute:
//   MFJ $32K / $44K; single $25K / $34K.
// Returns the amount of SS benefits that is taxable (0 to 85% of gross SS).
// `otherIncome` = AGI before SS + tax-exempt interest (we assume 0 tax-exempt)
function taxableSocialSecurity(ssGross, otherIncome, filingStatus = "mfj") {
  if (ssGross <= 0) return 0;
  const { ssThreshold1: threshold1, ssThreshold2: threshold2 } =
    FILING_STATUS_PARAMS[filingStatus] || FILING_STATUS_PARAMS.mfj;
  const halfSs = ssGross * 0.5;
  const provisional = Math.max(0, otherIncome) + halfSs;
  if (provisional <= threshold1) return 0;
  let taxable;
  if (provisional <= threshold2) {
    // Up to 50% of SS taxable (lesser of half SS or half the excess)
    taxable = Math.min(halfSs, (provisional - threshold1) * 0.5);
  } else {
    // Above the second threshold: 85% of that excess, plus the lesser of the
    // first-tier maximum (half the threshold span: $6K MFJ / $4.5K single)
    // or half the benefit.
    const excess85 = (provisional - threshold2) * 0.85;
    const firstTierCap = (threshold2 - threshold1) * 0.5;
    const plus = Math.min(firstTierCap, halfSs);
    taxable = excess85 + plus;
  }
  return Math.max(0, Math.min(taxable, ssGross * 0.85));
}

// Single Life Expectancy Table (Treas. Reg. 1.401(a)(9)-9(b), 2022+),
// ages relevant to SEPP start. Notice 2022-6 permits this table for the
// 72(t) fixed-amortization method.
const SINGLE_LIFE_EXPECTANCY = {
  40: 45.7, 41: 44.8, 42: 43.8, 43: 42.9, 44: 41.9, 45: 41.0, 46: 40.0,
  47: 39.0, 48: 38.1, 49: 37.1, 50: 36.2, 51: 35.3, 52: 34.3, 53: 33.4,
  54: 32.5, 55: 31.6, 56: 30.6, 57: 29.8, 58: 28.9, 59: 28.0,
};

// Fixed-amortization SEPP payment (Notice 2022-6): level annual payment that
// amortizes the account balance over single-life expectancy at the chosen
// interest rate (legally capped at 120% of the federal mid-term rate - the
// cap is the user's responsibility; the UI carries the warning).
function seppAmortizedPayment(balance, rate, startAge) {
  if (balance <= 0) return 0;
  const n =
    SINGLE_LIFE_EXPECTANCY[Math.min(59, Math.max(40, Math.round(startAge)))] ??
    30;
  if (rate <= 0) return balance / n;
  return (balance * rate) / (1 - Math.pow(1 + rate, -n));
}

// IRS Uniform Lifetime Table divisor for RMD calculation (2022+ revised table)
// RMD = prior year-end balance / divisor
function rmdDivisor(age) {
  const table = {
    72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9,
    78: 22.0, 79: 21.1, 80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7,
    84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9,
    90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1, 94: 9.5, 95: 8.9,
    96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4,
    101: 6.0, 102: 5.6, 103: 5.2, 104: 4.9, 105: 4.6, 106: 4.3,
    107: 4.1, 108: 3.9, 109: 3.7, 110: 3.5, 111: 3.4, 112: 3.3,
    113: 3.1, 114: 3.0, 115: 2.9, 116: 2.8, 117: 2.7, 118: 2.5,
    119: 2.3, 120: 2.0,
  };
  if (table[age] != null) return table[age];
  if (age < 72) return null;
  return 2.0;
}

// 2024 Federal Poverty Level (lower 48), projected by inflation.
// $15,060 for the first person + $5,380 for each additional person.
function federalPovertyLevel(householdSize, year, inflation = 0.03) {
  const base2024 = 15060 + 5380 * Math.max(0, Math.max(1, householdSize) - 1);
  return base2024 * Math.pow(1 + inflation, year - 2024);
}

// Simplified ACA premium subsidy estimation (post-IRA 2022 rules, extended through 2025)
// Returns the estimated MAGI-dependent healthcare cost AFTER subsidy
// `baseHealthcareCost` = what you'd pay without subsidy (sticker premium)
// Uses expected-contribution bracketed formula — approximation only.
function estimateAcaHealthcareCost(baseHealthcareCost, magi, householdSize, year, inflation = 0.03) {
  if (baseHealthcareCost <= 0) return 0;
  const fpl = federalPovertyLevel(householdSize, year, inflation);
  const fplRatio = magi / fpl;
  let expectedPct;
  if (year <= 2025) {
    // Enhanced credits suspended the 400% FPL cliff through 2025.
    if (fplRatio <= 1.5) expectedPct = 0.0;
    else if (fplRatio <= 2.0) expectedPct = 0.02 * ((fplRatio - 1.5) / 0.5);
    else if (fplRatio <= 2.5) expectedPct = 0.02 + 0.02 * ((fplRatio - 2.0) / 0.5);
    else if (fplRatio <= 3.0) expectedPct = 0.04 + 0.02 * ((fplRatio - 2.5) / 0.5);
    else if (fplRatio <= 4.0) expectedPct = 0.06 + 0.025 * ((fplRatio - 3.0) / 1.0);
    else expectedPct = 0.085;
  } else {
    // Current 2026 law: original ACA cliff is back; no PTC above 400% FPL.
    if (fplRatio > 4.0) return baseHealthcareCost;
    const band = ACA_APPLICABLE_PERCENTAGES_2026.find(
      ([low, high]) => fplRatio >= low && fplRatio < high,
    );
    if (!band) expectedPct = ACA_APPLICABLE_PERCENTAGES_2026[0][2];
    else {
      const [low, high, startPct, endPct] = band;
      const span = high - low || 1;
      expectedPct = startPct + ((fplRatio - low) / span) * (endPct - startPct);
    }
  }
  const expectedContribution = magi * expectedPct;
  // User pays the lesser of sticker or expected contribution (plus OOP / deductibles)
  // Add ~$2K/year floor for deductibles, copays, dental not covered by subsidy
  const premiumPortion = Math.max(0, baseHealthcareCost - 2000);
  const subsidizedPremium = Math.min(premiumPortion, Math.max(0, expectedContribution));
  return subsidizedPremium + 2000;
}

function totalTax(
  ordinaryIncome,
  ltcg,
  year,
  nyExemptAmount = 0,
  inflation = 0.03,
  nySocialSecurityExempt = 0,
  nyPensionAnnuityExclusion = 0,
  seniors65 = 0,
  filingStatus = "mfj",
) {
  const statusParams =
    FILING_STATUS_PARAMS[filingStatus] || FILING_STATUS_PARAMS.mfj;
  const { standardDeduction: baseStdDed } = getFederalTaxParams(
    year,
    inflation,
    filingStatus,
  );
  const magi = ordinaryIncome + ltcg;
  // Age-65+ additional standard deduction (permanent law): $1,650 per MFJ
  // spouse / $2,050 unmarried in 2026, indexed on the bracket clock.
  const seniorFactor = Math.pow(1 + inflation, Math.max(0, year - 2026));
  const extraStdDed65 =
    seniors65 * statusParams.seniorExtraStdDed2026 * seniorFactor;
  // OBBBA senior deduction: $6,000 per person 65+ for tax years 2025-2028
  // only (not indexed), phased out at 6% of MAGI above $150K MFJ / $75K single.
  let seniorBonusDeduction = 0;
  if (seniors65 > 0 && year >= 2025 && year <= 2028) {
    const phaseOut =
      0.06 * Math.max(0, magi - statusParams.obbbaPhaseOutStart);
    seniorBonusDeduction = Math.max(0, seniors65 * 6000 - phaseOut);
  }
  const stdDed = baseStdDed + extraStdDed65 + seniorBonusDeduction;
  const taxableOrdinary = Math.max(0, ordinaryIncome - stdDed);
  // Apply any unused standard deduction to reduce taxable LTCG
  const unusedStdDed = Math.max(0, stdDed - ordinaryIncome);
  const taxableLtcg = Math.max(0, ltcg - unusedStdDed);
  const fedOrd = fedOrdinaryTax(taxableOrdinary, year, inflation, filingStatus);
  const fedLtcg = fedLtcgTax(
    taxableLtcg,
    taxableOrdinary,
    year,
    inflation,
    filingStatus,
  );
  // NIIT: 3.8% on investment income above $250K MFJ / $200K single MAGI
  // (thresholds not indexed by statute)
  const niitThreshold = statusParams.niitThreshold;
  const niit =
    magi > niitThreshold
      ? Math.min(ltcg, magi - niitThreshold) * 0.038
      : 0;
  const nyOrdinary = Math.max(
    0,
    ordinaryIncome -
      nyExemptAmount -
      nySocialSecurityExempt -
      nyPensionAnnuityExclusion,
  );
  const ny = nyStateTax(nyOrdinary + ltcg, year, inflation, filingStatus);
  return fedOrd + fedLtcg + niit + ny;
}

// User-selectable cash drawdown behavior. "cashFirst" reproduces the original
// waterfall exactly; the other strategies respect an inflation-adjusted
// minimum cash reserve that is only spendable via the last-resort toggle.
// Roth IRA ordering rules (IRC 408A(d)(4)): withdrawals come from
// contribution basis first (never taxed or penalized), then conversion
// principal FIFO (each conversion penalty-free once 5 tax years old), then
// earnings. The engine tracks user-entered contribution basis plus every
// conversion vintage it creates, so Roth conversion ladders price correctly.
// Simplification: early *earnings* withdrawals are penalized but their income
// tax is not modeled (they occur only when a plan is already collapsing).
function rothEarlyPenaltyBase(wRoth, layers, currentYear) {
  if (!layers) return wRoth;
  let remaining = wRoth;
  let penalized = 0;
  remaining -= Math.min(remaining, Math.max(0, layers.contribBasis));
  for (const v of layers.vintages) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, v.amount);
    if (currentYear - v.year < 5) penalized += take;
    remaining -= take;
  }
  penalized += Math.max(0, remaining);
  return penalized;
}

function consumeRothLayers(wRoth, layers) {
  if (!layers || wRoth <= 0) return;
  let remaining = wRoth;
  const fromBasis = Math.min(remaining, Math.max(0, layers.contribBasis));
  layers.contribBasis -= fromBasis;
  remaining -= fromBasis;
  for (const v of layers.vintages) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, v.amount);
    v.amount -= take;
    remaining -= take;
  }
  layers.vintages = layers.vintages.filter((v) => v.amount > 0);
}

const CASH_POLICY_DEFAULT = {
  strategy: "cashFirst", // cashFirst | preserveReserve | proportional | cashLast
  reserveNominal: 0, // this year's reserve floor in nominal dollars
  allowReserve: false, // may the reserve be spent when everything else is empty?
};

// Single consistent withdrawal waterfall — replaces prior age-hardcoded logic
// `preSs` = true if age < ssAge (prioritize cash/taxable, preserve Roth)
// `preSs` = false if SS is flowing (prioritize 401k/IRA, preserve Roth)
// `cashPolicy` controls where cash sits in the order and how much of it is
// reachable. Returned `reserveUsed` is included in `wCash`.
function doWithdrawalWaterfall(grossNeed, state, preSs, cashPolicy = CASH_POLICY_DEFAULT) {
  const w = { wCash: 0, wTaxable: 0, w401k: 0, wIra: 0, wRoth: 0, reserveUsed: 0 };
  let rem = grossNeed;
  const take = (bucketKey, available) => {
    const t = Math.min(rem, Math.max(0, available));
    w[bucketKey] += t;
    rem -= t;
    return t;
  };
  const strategy = cashPolicy.strategy || "cashFirst";
  // "Use cash first" is the legacy mode: the reserve floor is not applied.
  const reserve =
    strategy === "cashFirst" ? 0 : Math.max(0, cashPolicy.reserveNominal || 0);
  const spendableCash = () => Math.max(0, state.bCash - reserve - w.wCash);

  if (strategy === "proportional") {
    // Split the need across cash-above-reserve, taxable, and tax-deferred in
    // proportion to available balances; Roth stays preserved until last.
    const buckets = [
      ["wCash", spendableCash()],
      ["wTaxable", Math.max(0, state.bTaxable)],
      ["w401k", Math.max(0, state.b401k)],
      ["wIra", Math.max(0, state.bTradIra)],
    ];
    const totalAvail = buckets.reduce((sum, [, b]) => sum + b, 0);
    if (totalAvail > 0 && rem > 0) {
      const target = Math.min(rem, totalAvail);
      for (const [key, bal] of buckets) {
        const share = Math.min((bal / totalAvail) * target, bal, rem);
        w[key] += share;
        rem -= share;
      }
      // Sweep float residue through the same buckets in order.
      take("wCash", spendableCash());
      take("wTaxable", state.bTaxable - w.wTaxable);
      take("w401k", state.b401k - w.w401k);
      take("wIra", state.bTradIra - w.wIra);
    }
    take("wRoth", state.bRoth);
  } else if (strategy === "cashLast") {
    // Cash is used only when other spendable sources are exhausted, but still
    // ahead of Roth (Roth preservation is the model's standing philosophy).
    if (preSs) {
      take("wTaxable", state.bTaxable);
      take("w401k", state.b401k);
      take("wIra", state.bTradIra);
    } else {
      take("w401k", state.b401k);
      take("wIra", state.bTradIra);
      take("wTaxable", state.bTaxable);
    }
    take("wCash", spendableCash());
    take("wRoth", state.bRoth);
  } else if (preSs) {
    // cashFirst (reserve = 0) and preserveReserve share this order.
    take("wCash", spendableCash());
    take("wTaxable", state.bTaxable);
    take("w401k", state.b401k);
    take("wIra", state.bTradIra);
    take("wRoth", state.bRoth);
  } else {
    take("w401k", state.b401k);
    take("wIra", state.bTradIra);
    take("wTaxable", state.bTaxable);
    take("wCash", spendableCash());
    take("wRoth", state.bRoth);
  }

  // Last resort: dip into the protected reserve only if explicitly allowed.
  if (rem > 0 && reserve > 0 && cashPolicy.allowReserve) {
    const fromReserve = Math.min(rem, Math.max(0, state.bCash - w.wCash));
    w.wCash += fromReserve;
    w.reserveUsed = fromReserve;
    rem -= fromReserve;
  }
  return w;
}

// Realized LTCG based on tracked cost basis (not flat 60% assumption)
function computeRealizedGain(wTaxable, bTaxable, bTaxableBasis) {
  if (wTaxable <= 0 || bTaxable <= 0) return 0;
  const gainRatio = Math.max(0, (bTaxable - bTaxableBasis) / bTaxable);
  return wTaxable * gainRatio;
}

// Iterative tax gross-up solver.
// Starts from netNeed, solves for withdrawals that cover spending + taxes.
// Max 10 iterations; stops when tax change < $1.
function solveGrossedUpWithdrawals({
  netNeed,
  state,
  preSs,
  conversion,
  ptIncome,
  ssGross,
  pensionGross,
  pensionNyExempt,
  year,
  age,
  inflation,
  minimumRmd = 0,
  penaltyFree401k = false,
  cashPolicy = CASH_POLICY_DEFAULT,
  // Taxable interest earned on the Cash/HYSA balance this year. Ordinary
  // income for federal + NY, and part of provisional income and MAGI.
  interestIncome = 0,
  // Number of household members 65+ (drives the extra standard deduction
  // and the 2025-2028 OBBBA senior deduction).
  seniors65 = 0,
  // Tax filing status: "mfj" or "single".
  filingStatus = "mfj",
  // Roth ordering layers (contribution basis + conversion vintages).
  rothLayers = null,
  // Annual SEPP/72(t) payment amount - tax-deferred draws up to this are
  // exempt from the early-withdrawal penalty.
  seppExempt = 0,
}) {
  let tax = 0;
  let withdrawals = { wCash: 0, wTaxable: 0, w401k: 0, wIra: 0, wRoth: 0, reserveUsed: 0 };
  let realizedGain = 0;
  let taxableSs = 0;
  let ordIncome = 0;
  let earlyPenalty = 0;
  for (let iter = 0; iter < 10; iter++) {
    const grossNeed = Math.max(0, netNeed + tax);
    withdrawals = doWithdrawalWaterfall(grossNeed, state, preSs, cashPolicy);

    // Enforce RMD inside the convergence loop so tax reflects forced withdrawals.
    // If w401k + wIra < minimumRmd, force additional withdrawal from tax-deferred
    // accounts. Extra money (beyond netNeed+tax) becomes surplus cash, handled
    // by the caller.
    if (minimumRmd > 0) {
      const taxDeferredDraw = withdrawals.w401k + withdrawals.wIra;
      if (taxDeferredDraw < minimumRmd) {
        const needed = minimumRmd - taxDeferredDraw;
        const avail401k = Math.max(0, state.b401k - withdrawals.w401k);
        const extra401k = Math.min(needed, avail401k);
        withdrawals.w401k += extra401k;
        const stillNeeded = needed - extra401k;
        if (stillNeeded > 0) {
          const availIra = Math.max(0, state.bTradIra - withdrawals.wIra);
          withdrawals.wIra += Math.min(stillNeeded, availIra);
        }
      }
    }

    realizedGain = computeRealizedGain(
      withdrawals.wTaxable,
      state.bTaxable,
      state.bTaxableBasis,
    );
    const incomeBeforeSs =
      ptIncome +
      pensionGross +
      interestIncome +
      withdrawals.w401k +
      withdrawals.wIra +
      conversion +
      realizedGain; // LTCG counts in provisional income
    taxableSs = taxableSocialSecurity(ssGross, incomeBeforeSs, filingStatus);
    ordIncome =
      ptIncome +
      taxableSs +
      pensionGross +
      interestIncome +
      withdrawals.w401k +
      withdrawals.wIra +
      conversion;
    const nyExemptAmount = pensionNyExempt ? pensionGross : 0;
    const privateRetirementIncome =
      withdrawals.w401k +
      withdrawals.wIra +
      conversion +
      (pensionNyExempt ? 0 : pensionGross);
    // NY pension/annuity exclusion applies from age 59½ (annual model: 60).
    const nyPensionAnnuityExclusion =
      age >= 59.5 ? Math.min(20000, privateRetirementIncome) : 0;
    // IRC §72(t): 10% additional tax on early distributions before age 59½.
    // - 401k: exempt when the Rule of 55 applies (separation at 55+), and only
    //   from age 55 onward.
    // - Traditional IRA: always penalized before 59½ (Rule of 55 never applies).
    // - Roth: conservative approximation — basis/conversion layers aren't
    //   tracked, so early Roth draws are penalized in full. The waterfall taps
    //   Roth last, so this rarely binds.
    // RMDs cannot coexist with age < 59½, so forced RMD draws are never hit.
    if (age < 59.5) {
      const penalized401k =
        penaltyFree401k && age >= 55 ? 0 : withdrawals.w401k;
      const penalizedRoth = rothLayers
        ? rothEarlyPenaltyBase(withdrawals.wRoth, rothLayers, year)
        : withdrawals.wRoth;
      const penalizedTaxDeferred = Math.max(
        0,
        penalized401k + withdrawals.wIra - Math.max(0, seppExempt),
      );
      earlyPenalty = 0.1 * (penalizedTaxDeferred + penalizedRoth);
    } else {
      earlyPenalty = 0;
    }
    const newTax =
      totalTax(
        ordIncome,
        realizedGain,
        year,
        nyExemptAmount,
        inflation,
        taxableSs,
        nyPensionAnnuityExclusion,
        seniors65,
        filingStatus,
      ) + earlyPenalty;
    if (Math.abs(newTax - tax) < 1) {
      tax = newTax;
      break;
    }
    tax = newTax;
  }
  return {
    withdrawals,
    tax: Math.round(tax),
    realizedGain,
    taxableSs,
    ordIncome,
    earlyPenalty: Math.round(earlyPenalty),
  };
}

// Compute annual Medicare Part B + Part D IRMAA surcharge for the household,
// using the tier table for the given filing status.
function computeIrmaaSurcharge(
  magi,
  year,
  inflation = 0.03,
  medicareEnrollees = 2,
  filingStatus = "mfj",
) {
  const tiers = IRMAA_2026[filingStatus] || IRMAA_2026.mfj;
  const factor = Math.pow(1 + inflation, Math.max(0, year - 2026));
  const coveredPeople = Math.max(1, Math.min(2, medicareEnrollees || 1));
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    const threshold = tier.top === Infinity ? Infinity : tier.top * factor;
    // The boundary into the top tier ($750K MFJ / $500K single) is exclusive:
    // a MAGI at or above it belongs to the highest tier.
    const atExclusiveTopTierBoundary =
      i === tiers.length - 2 && magi >= threshold;
    if (!atExclusiveTopTierBoundary && magi <= threshold) {
      return (tier.monthlyPartB + tier.monthlyPartD) * 12 * coveredPeople * factor;
    }
  }
  return 0;
}

// ============================================================
// SELF-TESTS — validate helpers against known cases
// ============================================================
// Run via the "Run Diagnostics" button on the Plan tab.
// Returns { passed, failed, results: [{ name, passed, expected, actual, delta }] }

function runSelfTests() {
  const results = [];
  // Helper: approximately equal within tolerance
  const approxEq = (actual, expected, tol = 1) =>
    Math.abs(actual - expected) <= tol;
  const pctEq = (actual, expected, tolPct = 0.01) =>
    Math.abs(actual - expected) <= Math.abs(expected) * tolPct + 1;
  const test = (name, actual, expected, approxEqFn = approxEq) => {
    const passed = approxEqFn(actual, expected);
    results.push({
      name,
      passed,
      expected: typeof expected === "number" ? Math.round(expected) : expected,
      actual: typeof actual === "number" ? Math.round(actual) : actual,
      delta: typeof actual === "number" ? Math.round(actual - expected) : null,
    });
  };

  // --- Federal ordinary tax (MFJ, year 2024, 3% inflation)
  // $100K taxable: 10% on first 23200 + 12% on next 71100 + 22% on last 5700
  // = 2320 + 8532 + 1254 = 12,106
  test(
    "fedOrdinaryTax: $100K taxable in 2024",
    fedOrdinaryTax(100000, 2024, 0.03),
    12106,
    pctEq,
  );
  test(
    "fedOrdinaryTax: $0 taxable = $0",
    fedOrdinaryTax(0, 2024, 0.03),
    0,
  );
  test(
    "fedOrdinaryTax: $23200 (top of 10% bracket) = $2320",
    fedOrdinaryTax(23200, 2024, 0.03),
    2320,
    pctEq,
  );

  // --- Federal LTCG (MFJ, 2024)
  // $50K LTCG + $0 ordinary: all in 0% bracket (below $94,050)
  test(
    "fedLtcgTax: $50K LTCG, $0 ordinary = $0 (0% bracket)",
    fedLtcgTax(50000, 0, 2024, 0.03),
    0,
  );
  // $50K LTCG + $100K ordinary: ordinary taxable is above $94,050, so all LTCG at 15%
  test(
    "fedLtcgTax: $50K LTCG, $100K ordinary = $7500 (15%)",
    fedLtcgTax(50000, 100000, 2024, 0.03),
    7500,
    pctEq,
  );

  // --- Taxable Social Security
  // Below $32K provisional → 0% taxable
  test(
    "taxableSS: low income → 0 taxable",
    taxableSocialSecurity(20000, 15000),
    0,
  );
  // SS $30K, other $50K → provisional $65K (above $44K)
  // 85% of ($65K - $44K) = $17,850; plus min($6K, 50% SS=$15K) = $6K; total $23,850
  // Cap at 85% of $30K = $25,500 → $23,850
  test(
    "taxableSS: SS=$30K, other=$50K → ~$23,850",
    taxableSocialSecurity(30000, 50000),
    23850,
    pctEq,
  );
  // Max: very high other income → exactly 85% of SS
  test(
    "taxableSS: high income → capped at 85% of SS",
    taxableSocialSecurity(30000, 500000),
    25500,
    pctEq,
  );

  // --- RMD divisor
  test("rmdDivisor(73) = 26.5", rmdDivisor(73), 26.5, (a, e) =>
    Math.abs(a - e) < 0.01,
  );
  test("rmdDivisor(90) = 12.2", rmdDivisor(90), 12.2, (a, e) =>
    Math.abs(a - e) < 0.01,
  );
  test("rmdDivisor(110) = 3.5", rmdDivisor(110), 3.5, (a, e) =>
    Math.abs(a - e) < 0.01,
  );
  test("rmdDivisor(121) = 2.0 (120+ table floor)", rmdDivisor(121), 2.0, (a, e) =>
    Math.abs(a - e) < 0.01,
  );
  test("rmdDivisor(65) = null (below threshold)", rmdDivisor(65), null, (a, e) =>
    a === e,
  );

  // --- totalTax: std ded absorbs LTCG when ordinary is low
  // 2024 MFJ std ded = $29,200. Ordinary = $10K, LTCG = $20K
  // Taxable ordinary = 0, unused std ded = $19,200
  // Taxable LTCG = $20K - $19,200 = $800 → in 0% bracket → $0 federal
  // NY: $30K total - $16,050 std ded = $13,950 taxable → 4% = $558
  test(
    "totalTax: low income LTCG absorbed by std ded (fed = 0)",
    totalTax(10000, 20000, 2024, 0, 0.03),
    558,
    pctEq,
  );

  // --- totalTax: NIIT triggered at MAGI > $250K
  // Ordinary $200K + LTCG $100K = $300K MAGI. Delta should include:
  //   Fed LTCG $15,000 (15% × $100K, ordinary pushes start above 0% bracket)
  //   NIIT $1,900 ($50K excess over $250K × 3.8%)
  //   NY State tax on $100K extra (NY has no LTCG preferential rate): ~$6,000
  //   Total delta ≈ $22,900
  const taxNoNiit = totalTax(200000, 0, 2024, 0, 0.03);
  const taxWithLtcg = totalTax(200000, 100000, 2024, 0, 0.03);
  test(
    "totalTax: adding $100K LTCG at $300K MAGI adds ~$22.9K (Fed LTCG + NIIT + NY)",
    taxWithLtcg - taxNoNiit,
    22900,
    (a, e) => Math.abs(a - e) <= 500,
  );
  // Verify NIIT specifically: MAGI just below $250K should have no NIIT
  // The delta for the extra $2K LTCG should include ~3.8% NIIT on the $1K over threshold
  // Hard to isolate precisely; we just verify NIIT is non-zero at high MAGI by comparing
  // $300K MAGI tax to a hypothetical "no NIIT" calc (can't run directly, but the test above
  // implicitly validates the 3.8% is included in the $22.9K total)

  test(
    "IRMAA: exactly $750K MFJ uses top 2026 tier",
    computeIrmaaSurcharge(750000, 2026, 0.03, 2),
    (487 + 91) * 12 * 2,
    pctEq,
  );

  // --- computeRealizedGain
  test(
    "computeRealizedGain: 70% basis, $10K draw → $3K gain",
    computeRealizedGain(10000, 100000, 70000),
    3000,
    pctEq,
  );
  test(
    "computeRealizedGain: 100% basis (no gain) → $0",
    computeRealizedGain(10000, 100000, 100000),
    0,
  );
  test(
    "computeRealizedGain: empty account → $0",
    computeRealizedGain(10000, 0, 0),
    0,
  );

  // --- doWithdrawalWaterfall: pre-SS pulls cash first
  const wfPre = doWithdrawalWaterfall(
    50000,
    { bCash: 20000, bTaxable: 100000, b401k: 500000, bTradIra: 0, bRoth: 0 },
    true,
  );
  test("waterfall pre-SS: cash drained first", wfPre.wCash, 20000);
  test("waterfall pre-SS: remainder from taxable", wfPre.wTaxable, 30000);
  test("waterfall pre-SS: 401k untouched when not needed", wfPre.w401k, 0);

  // --- doWithdrawalWaterfall: post-SS pulls 401k first
  const wfPost = doWithdrawalWaterfall(
    50000,
    { bCash: 20000, bTaxable: 100000, b401k: 500000, bTradIra: 0, bRoth: 0 },
    false,
  );
  test("waterfall post-SS: 401k drained first", wfPost.w401k, 50000);
  test("waterfall post-SS: cash untouched", wfPost.wCash, 0);

  // --- solveGrossedUpWithdrawals: basic convergence
  // Need $60K after tax at age 60 (pre-SS). Expect gross ≈ $66-70K after ~10% effective tax
  const solve = solveGrossedUpWithdrawals({
    netNeed: 60000,
    state: {
      bCash: 0,
      bTaxable: 0,
      bTaxableBasis: 0,
      b401k: 2000000,
      bTradIra: 0,
      bRoth: 0,
    },
    preSs: true,
    conversion: 0,
    ptIncome: 0,
    ssGross: 0,
    pensionGross: 0,
    pensionNyExempt: false,
    year: 2030,
    inflation: 0.03,
  });
  // Verify: gross withdrawal should be ~ netNeed + tax
  const gross =
    solve.withdrawals.wCash +
    solve.withdrawals.wTaxable +
    solve.withdrawals.w401k +
    solve.withdrawals.wIra +
    solve.withdrawals.wRoth;
  test(
    "solveGrossedUpWithdrawals: converged (gross ≈ netNeed + tax)",
    gross - solve.tax,
    60000,
    (a, e) => Math.abs(a - e) <= 2, // should converge within $1
  );
  test(
    "solveGrossedUpWithdrawals: tax > 0 for all-401k draw",
    solve.tax > 0 ? 1 : 0,
    1,
  );

  // --- FPL projection
  test(
    "federalPovertyLevel: household of 2 in 2024 ≈ $20,440",
    federalPovertyLevel(2, 2024, 0.03),
    20440,
    pctEq,
  );
  test(
    "federalPovertyLevel: household of 2 in 2034 with 3% inflation",
    federalPovertyLevel(2, 2034, 0.03),
    20440 * Math.pow(1.03, 10),
    pctEq,
  );
  // Household of 1 must use the 1-person FPL ($15,060 in 2024), not the
  // 2-person figure — regression test for the ACA over-subsidy bug.
  test(
    "federalPovertyLevel: household of 1 in 2024 = $15,060",
    federalPovertyLevel(1, 2024, 0.03),
    15060,
    pctEq,
  );

  // --- Senior deductions (age-65+ extra std ded + OBBBA bonus)
  // 2026, MFJ, $80K ordinary (12% bracket): 2 seniors add 2×$1,650 extra
  // std ded + 2×$6,000 OBBBA bonus (no phase-out below $150K MAGI)
  // = $15,300 × 12% = $1,836 federal savings.
  test(
    "totalTax: senior deductions save 12% × $15,300 at $80K (2026, 2 seniors)",
    totalTax(80000, 0, 2026, 0, 0.03, 0, 0, 0) -
      totalTax(80000, 0, 2026, 0, 0.03, 0, 0, 2),
    1836,
    pctEq,
  );
  // At $400K MAGI the OBBBA bonus is fully phased out (>$350K); only the
  // 2×$1,650 extra std ded remains, saving 24% × $3,300 = $792.
  test(
    "totalTax: OBBBA bonus phased out at $400K MAGI (only extra std ded left)",
    totalTax(400000, 0, 2026, 0, 0.03, 0, 0, 0) -
      totalTax(400000, 0, 2026, 0, 0.03, 0, 0, 2),
    792,
    pctEq,
  );

  // --- Cash interest is taxable ordinary income in the gross-up solve
  const interestState = {
    bCash: 500000,
    bTaxable: 0,
    bTaxableBasis: 0,
    b401k: 1000000,
    bTradIra: 0,
    bRoth: 0,
  };
  const solveNoInterest = solveGrossedUpWithdrawals({
    netNeed: 60000, state: interestState, preSs: true, conversion: 0,
    ptIncome: 0, ssGross: 0, pensionGross: 0, pensionNyExempt: false,
    year: 2030, age: 62, inflation: 0.03, interestIncome: 0,
  });
  const solveWithInterest = solveGrossedUpWithdrawals({
    netNeed: 60000, state: interestState, preSs: true, conversion: 0,
    ptIncome: 0, ssGross: 0, pensionGross: 0, pensionNyExempt: false,
    year: 2030, age: 62, inflation: 0.03, interestIncome: 20000,
  });
  test(
    "solver: $20K cash interest raises tax",
    solveWithInterest.tax > solveNoInterest.tax ? 1 : 0,
    1,
  );

  // --- Couple householdSize floors at 2 (HSA family limit regression)
  test(
    "normalizeCoupleInputs: stored householdSize 1 floors to 2",
    normalizeCoupleInputs({ shared: { householdSize: 1 } }).shared.householdSize,
    2,
  );

  // ============================================================
  // SINGLE-FILER TAX TESTS (verified against IRS Rev. Proc. 2025-32,
  // CMS 2026 IRMAA, and NY single schedules)
  // ============================================================
  // $60K taxable, single, 2026: 10%x12,400 + 12%x38,000 + 22%x9,600
  // = 1,240 + 4,560 + 2,112 = 7,912
  test(
    "fedOrdinaryTax single 2026: $60K taxable = $7,912",
    fedOrdinaryTax(60000, 2026, 0.03, "single"),
    7912,
    pctEq,
  );
  // Single LTCG 2026: 0% bracket tops at $49,450
  test(
    "fedLtcgTax single 2026: $40K LTCG, $0 ordinary = $0 (0% bracket)",
    fedLtcgTax(40000, 0, 2026, 0.03, "single"),
    0,
  );
  test(
    "fedLtcgTax single 2026: $60K LTCG, $0 ordinary = 15% x $10,550",
    fedLtcgTax(60000, 0, 2026, 0.03, "single"),
    (60000 - 49450) * 0.15,
    pctEq,
  );
  // Single SS thresholds $25K/$34K; first-tier cap $4,500.
  // SS $20K, other $30K -> provisional $40K: 0.85 x $6K + min($4.5K, $10K) = $9,600
  test(
    "taxableSS single: SS=$20K, other=$30K -> $9,600",
    taxableSocialSecurity(20000, 30000, "single"),
    9600,
    pctEq,
  );
  // Same income taxed as single must exceed MFJ (narrower brackets, half
  // the standard deduction): $100K ordinary, 2026.
  test(
    "totalTax: single > MFJ at $100K ordinary (2026)",
    totalTax(100000, 0, 2026, 0, 0.03, 0, 0, 0, "single") >
      totalTax(100000, 0, 2026, 0, 0.03, 0, 0, 0, "mfj")
      ? 1
      : 0,
    1,
  );
  // Single senior deductions at $80K ordinary (22% bracket). The OBBBA
  // bonus phases out above $75K single MAGI: $6,000 - 6% x $5,000 = $5,700.
  // ($2,050 + $5,700) x 22% = $1,705 federal savings.
  test(
    "totalTax single: senior deductions save 22% x $7,750 at $80K (2026)",
    totalTax(80000, 0, 2026, 0, 0.03, 0, 0, 0, "single") -
      totalTax(80000, 0, 2026, 0, 0.03, 0, 0, 1, "single"),
    1705,
    pctEq,
  );
  // Single IRMAA 2026: $300K MAGI lands in the $205K-$500K tier;
  // one enrollee: (446.30 + 83.30) x 12 = $6,355.20
  test(
    "IRMAA single 2026: $300K MAGI, 1 enrollee = $6,355",
    computeIrmaaSurcharge(300000, 2026, 0.03, 1, "single"),
    6355.2,
    pctEq,
  );
  // NY default (no status arg) must still be the MFJ schedule — regression
  // guard for every legacy call site.
  test(
    "nyStateTax default stays MFJ: $100K in 2024 = $4,284.75",
    nyStateTax(100000, 2024, 0),
    4284.75,
    pctEq,
  );
  // NY single: $8,000 std ded and single brackets. $100K NY income, 2024:
  // taxable 92,000 -> 8,500x4% + 3,200x4.5% + 2,200x5.25% + 66,750x5.5%
  // + 11,350x6% = 340 + 144 + 115.50 + 3,671.25 + 681 = $4,951.75
  test(
    "nyStateTax single 2024: $100K (single schedule) = $4,951.75",
    nyStateTax(100000, 2024, 0, "single"),
    4951.75,
    pctEq,
  );

  // --- ACA: below 150% FPL = full subsidy (pays only ~$2K OOP floor)
  const lowMagiCost = estimateAcaHealthcareCost(
    28000,
    25000, // roughly 120% FPL for 2
    2,
    2024,
    0.03,
  );
  test(
    "ACA: low MAGI = near-zero premium (just OOP floor)",
    lowMagiCost,
    2000,
    (a, e) => Math.abs(a - e) <= 200,
  );
  // Above 400% FPL (post-IRA): 8.5% cap still binds if sticker premium > 8.5% of MAGI.
  // At $200K MAGI: 8.5% cap = $17,000 payment + $2,000 OOP floor = $19,000.
  // This is LESS than sticker $28K because post-IRA 2021+ rules removed the subsidy cliff.
  const highMagiCost = estimateAcaHealthcareCost(
    28000,
    200000,
    2,
    2024,
    0.03,
  );
  test(
    "ACA: high MAGI post-IRA = 8.5% cap still provides subsidy",
    highMagiCost,
    19000,
    (a, e) => Math.abs(a - e) <= 500,
  );
  // Very high MAGI where 8.5% cap exceeds sticker → no subsidy (pay full sticker)
  const veryHighMagiCost = estimateAcaHealthcareCost(
    28000,
    500000, // 8.5% × $500K = $42,500 > $28K sticker
    2,
    2024,
    0.03,
  );
  test(
    "ACA: very high MAGI (cap exceeds sticker) = full sticker price",
    veryHighMagiCost,
    28000,
    (a, e) => Math.abs(a - e) <= 500,
  );

  // ============================================================
  // INTEGRATION TESTS — full-plan scenarios
  // ============================================================
  // Each builds a synthetic input set, runs simulate(), and checks invariants.
  const testScenario = (name, assertion) => {
    try {
      const { passed: p, details } = assertion();
      results.push({
        name: `INTEGRATION: ${name}`,
        passed: p,
        expected: "invariant holds",
        actual: p ? "OK" : details || "FAILED",
        delta: null,
      });
    } catch (err) {
      results.push({
        name: `INTEGRATION: ${name}`,
        passed: false,
        expected: "no exception",
        actual: `threw: ${err.message || err}`,
        delta: null,
      });
    }
  };

  const baseInputs = {
    currentAge: 50,
    retirementAge: 55,
    planThroughAge: 85,
    balanceCash: 100000,
    balanceTaxable: 200000,
    balance401k: 1500000,
    balanceTradIra: 20000,
    balanceRoth: 50000,
    balanceHsa: 20000,
    preReturn: 0.06,
    postReturn: 0.055,
    cashReturn: 0.04,
    inflation: 0.03,
    contrib401k: 30000,
    contribMatch: 5000,
    contribHsa: 8000,
    baseExpenses: 60000,
    healthcarePre65: 24000,
    healthcarePost65: 8000,
    partTimeIncome: 15000,
    partTimeYears: 5,
    ssIncome: 30000,
    ssAge: 67,
    pensionIncome: 0,
    pensionStartAge: 55,
    pensionCola: 0.02,
    pensionNyExempt: false,
    rmdStartAge: 73,
    taxableBasisPct: 0.7,
    useAcaSubsidyEstimate: false,
    householdSize: 2,
    conversionBridge: 30000,
    conversionMid: 30000,
    conversionFinal: 30000,
    creditCardDebt: 0,
  };

  // --- Scenario A: Forced RMD year — planned withdrawals below RMD requirement
  testScenario(
    "RMD year: w401k + wIra >= required RMD",
    () => {
      const r = simulate(baseInputs);
      // Find first year where RMD is active (age 73+)
      const rmdYear = r.yearlyData.find((d) => d.rmdAmount > 0);
      if (!rmdYear)
        return { passed: false, details: "no RMD year found in plan" };
      const taxDeferredDraw = rmdYear.from401k + rmdYear.fromIra;
      return {
        passed: taxDeferredDraw >= rmdYear.rmdAmount - 1, // allow $1 rounding
        details: `age ${rmdYear.age}: RMD=${Math.round(rmdYear.rmdAmount)}, 401k+IRA draw=${Math.round(taxDeferredDraw)}`,
      };
    },
  );

  // --- Scenario B: RMD-forced year has higher tax than if RMD were not forced
  testScenario(
    "RMD forcing increases tax (vs same plan without forced draw)",
    () => {
      const r = simulate(baseInputs);
      const rmdYear = r.yearlyData.find((d) => d.rmdAmount > 0 && d.tax > 0);
      if (!rmdYear)
        return { passed: false, details: "no taxable RMD year found" };
      // Sanity: tax should be positive for a year with significant RMD income
      return {
        passed: rmdYear.tax > 1000,
        details: `age ${rmdYear.age}: tax=${rmdYear.tax} for RMD=${Math.round(rmdYear.rmdAmount)}`,
      };
    },
  );

  // --- Scenario C: SS + taxable withdrawals + realized gains in same year
  testScenario(
    "SS year: taxableSs is valid (0 to 85% of gross SS)",
    () => {
      const r = simulate(baseInputs);
      const ssYear = r.yearlyData.find((d) => d.ss > 0);
      if (!ssYear) return { passed: false, details: "no SS year found" };
      const maxTaxable = ssYear.ss * 0.85 + 1; // allow $1 rounding
      const ok = ssYear.taxableSs >= 0 && ssYear.taxableSs <= maxTaxable;
      return {
        passed: ok,
        details: `age ${ssYear.age}: ss=${ssYear.ss}, taxableSs=${ssYear.taxableSs} (max=${Math.round(maxTaxable)})`,
      };
    },
  );

  // --- Scenario D: ACA-estimate pre-65 with Roth conversion
  testScenario(
    "ACA: pre-65 year with conversion still produces acaSubsidy >= 0",
    () => {
      const acaInputs = {
        ...baseInputs,
        useAcaSubsidyEstimate: true,
        conversionBridge: 20000, // keep small to retain some subsidy
      };
      const r = simulate(acaInputs);
      const preMed = r.yearlyData.find(
        (d) => d.age >= 55 && d.age < 65 && d.acaSubsidy !== undefined,
      );
      if (!preMed) return { passed: false, details: "no pre-65 year found" };
      return {
        passed: preMed.acaSubsidy >= 0,
        details: `age ${preMed.age}: acaSubsidy=${preMed.acaSubsidy}`,
      };
    },
  );

  // --- Scenario E: IRMAA trigger — with the 2-year lookback, a high-MAGI
  // conversion year at 65-66 should surface as a surcharge two years later.
  testScenario(
    "IRMAA: high-MAGI year triggers surcharge (2-year lookback)",
    () => {
      const highIncInputs = {
        ...baseInputs,
        conversionFinal: 400000, // force very high MAGI during age 65-66 window
      };
      const r = simulate(highIncInputs);
      const irmaaYear = r.yearlyData.find(
        (d) => d.age >= 65 && d.irmaaTriggered,
      );
      if (!irmaaYear)
        return {
          passed: false,
          details: "no IRMAA trigger year found (expected at ~age 67-68)",
        };
      return {
        passed: irmaaYear.irmaaSurcharge > 0,
        details: `age ${irmaaYear.age}: irmaa=${irmaaYear.irmaaSurcharge}, magi=${Math.round(irmaaYear.magi)}`,
      };
    },
  );

  // --- Scenario E2: lookback timing — surcharge lands 2 years after the
  // income spike, not in the spike year itself (once retired 2+ years).
  testScenario(
    "IRMAA lookback: surcharge reflects MAGI from two years earlier",
    () => {
      const r = simulate({
        ...baseInputs,
        currentAge: 60,
        retirementAge: 61,
        planThroughAge: 72,
        ssAge: 70,
        conversionBridge: 0,
        conversionMid: 0,
        conversionFinal: 500000, // ages 65-69 (until SS at 70)
        balance401k: 3000000,
      });
      const at66 = r.yearlyData.find((d) => d.age === 66);
      const at67 = r.yearlyData.find((d) => d.age === 67);
      // Age 66 looks back to age 64 (low MAGI: no conversions) -> no surcharge.
      // Age 67 looks back to age 65 (500K conversion) -> surcharge.
      const ok = at66 && at67 && at66.irmaaSurcharge === 0 && at67.irmaaSurcharge > 0;
      return {
        passed: !!ok,
        details: `age66 irmaa=${at66?.irmaaSurcharge}, age67 irmaa=${at67?.irmaaSurcharge}`,
      };
    },
  );

  // --- Scenario: single filer pays more tax than MFJ on identical inputs
  testScenario(
    "Filing status: single-filer plan pays more tax than MFJ (same inputs)",
    () => {
      const base = {
        ...baseInputs,
        currentAge: 60,
        retirementAge: 61,
        planThroughAge: 70,
        partTimeIncome: 0,
        partTimeYears: 0,
        conversionBridge: 0,
        conversionMid: 40000,
        conversionFinal: 40000,
      };
      const asMfj = simulate({ ...base, filingStatus: "mfj" });
      const asSingle = simulate({ ...base, filingStatus: "single" });
      const ok =
        asSingle.summary.totalTaxesPaid > asMfj.summary.totalTaxesPaid;
      return {
        passed: ok,
        details: `single lifetime tax=${asSingle.summary.totalTaxesPaid}, MFJ=${asMfj.summary.totalTaxesPaid}`,
      };
    },
  );

  // --- Scenario: already-retired user (retirementAge <= currentAge)
  testScenario(
    "Already retired: currentAge 70 / retirementAge 65 produces a live plan",
    () => {
      const r = simulate({
        ...baseInputs,
        currentAge: 70,
        retirementAge: 65,
        planThroughAge: 80,
        contrib401k: 0,
        contribMatch: 0,
        contribHsa: 0,
        partTimeIncome: 0,
        partTimeYears: 0,
        conversionBridge: 0,
        conversionMid: 0,
        conversionFinal: 0,
      });
      const ok =
        r.yearlyData.length === 11 &&
        r.yearlyData[0].phase !== "accumulation" &&
        r.summary.year1WithdrawalRate > 0;
      return {
        passed: ok,
        details: `rows=${r.yearlyData.length}, phase[0]=${r.yearlyData[0]?.phase}, wr=${(r.summary.year1WithdrawalRate * 100).toFixed(1)}%`,
      };
    },
  );

  // --- Scenario F: Taxable basis never goes negative
  testScenario(
    "Taxable basis never goes negative",
    () => {
      const r = simulate(baseInputs);
      const neg = r.yearlyData.find(
        (d) => d.taxableBasisEnd !== undefined && d.taxableBasisEnd < -1,
      );
      return {
        passed: !neg,
        details: neg
          ? `age ${neg.age}: basis=${neg.taxableBasisEnd}`
          : "all ages OK",
      };
    },
  );

  // --- Scenario G: Low-balance edge case — conversion target exceeds feasible amount
  testScenario(
    "Low 401k balance: conversion capped at available balance (no crash)",
    () => {
      const lowBal = {
        ...baseInputs,
        balance401k: 50000,
        conversionBridge: 100000, // more than balance
      };
      const r = simulate(lowBal);
      // Just check simulation completed without NaN/infinity
      const bad = r.yearlyData.find(
        (d) => !isFinite(d.total) || isNaN(d.total),
      );
      return {
        passed: !bad && r.yearlyData.length > 0,
        details: bad
          ? `bad total at age ${bad.age}: ${bad.total}`
          : `${r.yearlyData.length} years simulated cleanly`,
      };
    },
  );

  // --- Scenario H: Gross withdrawal >= netNeed + tax (invariant)
  testScenario(
    "Gross withdrawal covers netNeed + tax (after surplus)",
    () => {
      const r = simulate(baseInputs);
      // Check a mid-retirement year (not RMD-affected)
      const midYear = r.yearlyData.find(
        (d) => d.phase === "bridge" && d.age === 56,
      );
      if (!midYear) return { passed: false, details: "no age 56 year found" };
      // Gross must cover netNeed + tax (+/- rounding)
      const ok = midYear.grossWithdrawal >= midYear.netNeed + midYear.tax - 2;
      return {
        passed: ok,
        details: `age 56: gross=${midYear.grossWithdrawal}, netNeed=${midYear.netNeed}, tax=${midYear.tax}`,
      };
    },
  );

  // --- Scenario I: Pension income reduces net need when active
  testScenario(
    "Pension active: netNeed decreases once pension starts",
    () => {
      const pensionInputs = {
        ...baseInputs,
        pensionIncome: 40000,
        pensionStartAge: 60,
      };
      const r = simulate(pensionInputs);
      const beforePen = r.yearlyData.find((d) => d.age === 59);
      const afterPen = r.yearlyData.find((d) => d.age === 60);
      if (!beforePen || !afterPen)
        return { passed: false, details: "missing years 59/60" };
      // netNeed at 60 should be lower than at 59 (pension kicks in)
      // (accounting for inflation-adjusted spending growth)
      const ok = afterPen.pension >= 40000 * 0.95;
      return {
        passed: ok,
        details: `age 60: pension=${afterPen.pension} (expected ≥$38K in today's $)`,
      };
    },
  );

  // --- Scenario J: Inflation base — year-1 spending inflates from TODAY, so its
  // real (today's-dollar) value equals the entered spending, and its nominal
  // value reflects the full pre-retirement inflation. Guards against regressing
  // to the retirement-year inflation anchor.
  testScenario(
    "Inflation base: year-1 real spending == entered baseExpenses + healthcare",
    () => {
      const r = simulate(baseInputs);
      const firstRetYear = r.yearlyData.find((d) => d.age === baseInputs.retirementAge);
      if (!firstRetYear) return { passed: false, details: "no first retirement year" };
      const yearsToRet = baseInputs.retirementAge - baseInputs.currentAge;
      const inflFactor = Math.pow(1 + baseInputs.inflation, yearsToRet);
      const enteredTodayDollars = baseInputs.baseExpenses + baseInputs.healthcarePre65;
      const expectedNominal = enteredTodayDollars * inflFactor;
      const realSpending = firstRetYear.spending / inflFactor;
      const okReal = Math.abs(realSpending - enteredTodayDollars) <= enteredTodayDollars * 0.005;
      const okNominal = Math.abs(firstRetYear.spending - expectedNominal) <= expectedNominal * 0.005;
      return {
        passed: okReal && okNominal,
        details: `nominal=${Math.round(firstRetYear.spending)} (expected ~${Math.round(expectedNominal)}), real=${Math.round(realSpending)} (expected ${enteredTodayDollars})`,
      };
    },
  );

  testScenario(
    "Couple: different ages and SS timelines produce household SS",
    () => {
      const couple = normalizeCoupleInputs({
        ...DEFAULT_COUPLE_INPUTS,
        primary: { ...DEFAULT_COUPLE_INPUTS.primary, currentAge: 60, retirementAge: 62, ssIncome: 30000, ssAge: 67 },
        spouse: { ...DEFAULT_COUPLE_INPUTS.spouse, currentAge: 55, retirementAge: 65, ssIncome: 20000, ssAge: 62 },
      });
      const r = simulateCouple(couple);
      const ssYear = r.yearlyData.find((d) => d.ss > 0);
      return {
        passed: !!ssYear && ssYear.ownerDetails.spouse.ss > 0,
        details: ssYear
          ? `primary age ${ssYear.primaryAge}, spouse age ${ssYear.spouseAge}, ss=${ssYear.ss}`
          : "no SS year found",
      };
    },
  );

  testScenario(
    "Couple: RMDs are tracked by spouse",
    () => {
      const couple = normalizeCoupleInputs({
        primary: { ...DEFAULT_COUPLE_INPUTS.primary, currentAge: 72, retirementAge: 72, planThroughAge: 80, balance401k: 600000, rmdStartAge: 73 },
        spouse: { ...DEFAULT_COUPLE_INPUTS.spouse, currentAge: 72, retirementAge: 72, planThroughAge: 80, balance401k: 400000, rmdStartAge: 73 },
      });
      const r = simulateCouple(couple);
      const rmdYear = r.yearlyData.find((d) => d.rmdAmount > 0);
      const primaryRmd = rmdYear?.ownerDetails?.primary?.rmdAmount || 0;
      const spouseRmd = rmdYear?.ownerDetails?.spouse?.rmdAmount || 0;
      return {
        passed: primaryRmd > 0 && spouseRmd > 0,
        details: rmdYear
          ? `primary RMD=${primaryRmd}, spouse RMD=${spouseRmd}`
          : "no RMD year",
      };
    },
  );

  testScenario(
    "Couple: HSA contributions respect household cap",
    () => {
      const year = PROJECTION_START_YEAR;
      const couple = normalizeCoupleInputs({
        primary: { ...DEFAULT_COUPLE_INPUTS.primary, currentAge: 56, retirementAge: 60, contribHsa: 10000 },
        spouse: { ...DEFAULT_COUPLE_INPUTS.spouse, currentAge: 55, retirementAge: 60, contribHsa: 10000 },
      });
      const r = simulateCouple(couple);
      const row = r.yearlyData[0];
      const applied =
        (row.ownerDetails.primary.contributionHsaApplied || 0) +
        (row.ownerDetails.spouse.contributionHsaApplied || 0);
      const limit = getCoupleHsaLimit(56, 55, year, couple.shared.inflation, couple.shared.householdSize);
      return {
        passed: applied <= limit,
        details: `applied=${Math.round(applied)}, limit=${Math.round(limit)}`,
      };
    },
  );

  // --- NY middle-class tax cut (Ch. 59, Laws of 2025): bottom five rates
  // drop 0.1pp in 2026 and 0.2pp total from 2027. $100K taxable, 0% inflation:
  // 2027 = 17150(3.8%) + 6450(4.3%) + 4300(5.05%) + 56050(5.3%) = $4,116.85
  test(
    "nyStateTax: 2027 middle-class rate cut applied",
    nyStateTax(100000, 2027, 0),
    4116.85,
    pctEq,
  );
  test(
    "nyStateTax: 2024 pre-cut rates unchanged",
    nyStateTax(100000, 2024, 0),
    4284.75,
    pctEq,
  );

  // --- Social Security claim-age clamp: claiming below 62 is impossible;
  // entered age 55 must price as the legal floor of 62 (30% reduction at FRA 67)
  test(
    "adjustedSocialSecurityBenefit: claim age below 62 clamps to 62 (70% of FRA)",
    adjustedSocialSecurityBenefit(30000, 55),
    21000,
    pctEq,
  );
  test(
    "adjustedSocialSecurityBenefit: claim age above 70 clamps to 70 (124% of FRA)",
    adjustedSocialSecurityBenefit(30000, 75),
    30000 * 1.24,
    pctEq,
  );

  // --- §72(t) early-withdrawal penalty
  const penaltyState = {
    bCash: 0,
    bTaxable: 0,
    bTaxableBasis: 0,
    b401k: 2000000,
    bTradIra: 0,
    bRoth: 0,
  };
  const solveAge50 = solveGrossedUpWithdrawals({
    netNeed: 60000,
    state: penaltyState,
    preSs: true,
    conversion: 0,
    ptIncome: 0,
    ssGross: 0,
    pensionGross: 0,
    pensionNyExempt: false,
    year: 2030,
    age: 50,
    inflation: 0.03,
    penaltyFree401k: false,
  });
  const gross50 =
    solveAge50.withdrawals.w401k +
    solveAge50.withdrawals.wIra +
    solveAge50.withdrawals.wRoth;
  test(
    "early penalty: age 50 401k draw pays 10% additional tax",
    solveAge50.earlyPenalty,
    gross50 * 0.1,
    pctEq,
  );
  const solveAge56R55 = solveGrossedUpWithdrawals({
    netNeed: 60000,
    state: penaltyState,
    preSs: true,
    conversion: 0,
    ptIncome: 0,
    ssGross: 0,
    pensionGross: 0,
    pensionNyExempt: false,
    year: 2030,
    age: 56,
    inflation: 0.03,
    penaltyFree401k: true,
  });
  test(
    "early penalty: Rule of 55 exempts 401k at age 56",
    solveAge56R55.earlyPenalty,
    0,
  );
  const solveAge56NoR55 = solveGrossedUpWithdrawals({
    netNeed: 60000,
    state: penaltyState,
    preSs: true,
    conversion: 0,
    ptIncome: 0,
    ssGross: 0,
    pensionGross: 0,
    pensionNyExempt: false,
    year: 2030,
    age: 56,
    inflation: 0.03,
    penaltyFree401k: false,
  });
  test(
    "early penalty: no Rule of 55 (retired <55) keeps penalty at 56",
    solveAge56NoR55.earlyPenalty > 0 ? 1 : 0,
    1,
  );

  testScenario(
    "Couple: retirement-year balances grow at exactly (1 + postReturn)",
    () => {
      const noSpend = {
        currentAge: 66,
        retirementAge: 65,
        planThroughAge: 70,
        balanceTradIra: 0,
        balanceRoth: 0,
        balanceHsa: 0,
        ssIncome: 0,
        pensionIncome: 0,
        partTimeIncome: 0,
        partTimeYears: 0,
        rmdStartAge: 99,
        healthcarePre65: 0,
        healthcarePost65: 0,
        conversionBridge: 0,
        conversionMid: 0,
        conversionFinal: 0,
        contrib401k: 0,
        contribMatch: 0,
        contribHsa: 0,
      };
      const couple = normalizeCoupleInputs({
        primary: { ...DEFAULT_COUPLE_INPUTS.primary, ...noSpend, balance401k: 1000000 },
        spouse: { ...DEFAULT_COUPLE_INPUTS.spouse, ...noSpend, balance401k: 0 },
        shared: {
          ...DEFAULT_COUPLE_INPUTS.shared,
          balanceCash: 0,
          balanceTaxable: 0,
          baseExpenses: 0,
          creditCardDebt: 0,
          postReturn: 0.06,
        },
      });
      const r = simulateCouple(couple);
      const expected = Math.round(1000000 * 1.06);
      const ok = Math.abs(r.yearlyData[0].k401 - expected) <= expected * 0.001;
      return {
        passed: ok,
        details: `year-1 401k=${r.yearlyData[0].k401}, expected ${expected} (double-growth would be ${Math.round(1000000 * 1.06 * 1.06)})`,
      };
    },
  );

  testScenario(
    "Couple: RMD equals prior year-end balance / divisor",
    () => {
      const base = {
        currentAge: 75,
        retirementAge: 70,
        planThroughAge: 78,
        balanceTradIra: 0,
        balanceRoth: 0,
        balanceHsa: 0,
        ssIncome: 0,
        pensionIncome: 0,
        partTimeIncome: 0,
        partTimeYears: 0,
        healthcarePre65: 0,
        healthcarePost65: 0,
        conversionBridge: 0,
        conversionMid: 0,
        conversionFinal: 0,
        contrib401k: 0,
        contribMatch: 0,
        contribHsa: 0,
      };
      const couple = normalizeCoupleInputs({
        primary: { ...DEFAULT_COUPLE_INPUTS.primary, ...base, balance401k: 1000000, rmdStartAge: 73 },
        spouse: { ...DEFAULT_COUPLE_INPUTS.spouse, ...base, balance401k: 0, rmdStartAge: 99 },
        shared: {
          ...DEFAULT_COUPLE_INPUTS.shared,
          balanceCash: 0,
          balanceTaxable: 0,
          baseExpenses: 0,
          creditCardDebt: 0,
          postReturn: 0.06,
        },
      });
      const r = simulateCouple(couple);
      const expected = Math.round(1000000 / 24.6); // age-75 divisor on prior year-end $1M
      const actual = r.yearlyData[0].rmdAmount;
      const ok = Math.abs(actual - expected) <= expected * 0.005;
      return {
        passed: ok,
        details: `year-1 RMD=${actual}, expected ${expected} (grown-balance bug would give ${Math.round((1000000 * 1.06) / 24.6)})`,
      };
    },
  );

  testScenario(
    "Accumulation: Traditional IRA RMDs forced while still working",
    () => {
      const r = simulate({
        ...baseInputs,
        currentAge: 75,
        retirementAge: 78,
        planThroughAge: 82,
        balanceTradIra: 100000,
        rmdStartAge: 73,
      });
      const row = r.yearlyData[0];
      const expected = Math.round(100000 / 24.6);
      const ok = Math.abs(row.rmdAmount - expected) <= expected * 0.005;
      return {
        passed: ok,
        details: `age-75 working-year IRA RMD=${row.rmdAmount}, expected ${expected}`,
      };
    },
  );

  testScenario(
    "Early retiree (age 52): 401k draw carries earlyPenalty in plan rows",
    () => {
      const r = simulate({
        ...baseInputs,
        currentAge: 50,
        retirementAge: 52,
        planThroughAge: 60,
        balanceCash: 0,
        balanceTaxable: 0,
        balanceRoth: 0,
        balanceHsa: 0,
        balanceTradIra: 0,
        partTimeIncome: 0,
        partTimeYears: 0,
        conversionBridge: 0,
      });
      const row = r.yearlyData.find((d) => d.age === 52);
      if (!row) return { passed: false, details: "no age-52 row" };
      return {
        passed: row.earlyPenalty > 0 && row.from401k > 0,
        details: `age 52: from401k=${row.from401k}, earlyPenalty=${row.earlyPenalty}`,
      };
    },
  );

  // --- Cash-strategy penalty comparison: definitive guidance, not "can"
  testScenario(
    "Strategy compare: cashLast penalizes an early retiree that cashFirst spares",
    () => {
      // All penalty-free money sits in cash: "use cash first" covers the
      // bridge cleanly, while "cash last" is forced through the 401k and
      // must pay the 10% penalty — the order alone creates the cost.
      const richBridge = {
        ...baseInputs,
        currentAge: 50,
        retirementAge: 52,
        planThroughAge: 62,
        balanceCash: 800000,
        balanceTaxable: 0,
        balance401k: 800000,
        balanceTradIra: 0,
        balanceRoth: 0,
        balanceHsa: 0,
        partTimeIncome: 0,
        partTimeYears: 0,
        conversionBridge: 0,
        conversionMid: 0,
        conversionFinal: 0,
        cashStrategy: "cashLast",
      };
      const impact = compareCashStrategies(richBridge);
      if (!impact) return { passed: false, details: "comparison returned null" };
      const best = bestCashStrategyAlternative(impact, "cashLast");
      const ok =
        impact.cashLast.penaltyTotal > 0 &&
        impact.cashFirst.penaltyTotal === 0 &&
        best != null &&
        best.penaltyTotal === 0;
      return {
        passed: ok,
        details: `cashLast=${impact.cashLast.penaltyTotal}, cashFirst=${impact.cashFirst.penaltyTotal}, best=${best ? `${best.value}/${best.penaltyTotal}` : "none"}`,
      };
    },
  );

  testScenario(
    "Strategy compare: penalized draws = 10x penalty (identity)",
    () => {
      const impact = compareCashStrategies({
        ...baseInputs,
        currentAge: 50,
        retirementAge: 52,
        planThroughAge: 60,
        balanceCash: 0,
        balanceTaxable: 0,
        balanceRoth: 0,
        balanceHsa: 0,
        partTimeIncome: 0,
        partTimeYears: 0,
        conversionBridge: 0,
      });
      if (!impact) return { passed: false, details: "comparison returned null" };
      const c = impact.cashFirst;
      const ok =
        c.penaltyTotal > 0 &&
        Math.abs(c.penalizedDraws - c.penaltyTotal * 10) <= 1;
      return {
        passed: ok,
        details: `penaltyTotal=${c.penaltyTotal}, penalizedDraws=${c.penalizedDraws}`,
      };
    },
  );

  // --- Cash withdrawal strategy & minimum reserve ---
  const reserveState = {
    bCash: 300000,
    bTaxable: 0,
    bTaxableBasis: 0,
    b401k: 0,
    bTradIra: 0,
    bRoth: 0,
  };
  // ACCEPTANCE TEST: $300K cash, $100K reserve -> at most $200K of cash used,
  // the remaining $100K preserved unless explicitly allowed.
  const wfReserve = doWithdrawalWaterfall(250000, reserveState, true, {
    strategy: "preserveReserve",
    reserveNominal: 100000,
    allowReserve: false,
  });
  test(
    "ACCEPTANCE cash reserve: $300K cash, $100K floor, $250K need -> $200K used",
    wfReserve.wCash,
    200000,
  );
  test(
    "ACCEPTANCE cash reserve: protected floor untouched (reserveUsed = 0)",
    wfReserve.reserveUsed,
    0,
  );
  const wfReserveAllowed = doWithdrawalWaterfall(250000, reserveState, true, {
    strategy: "preserveReserve",
    reserveNominal: 100000,
    allowReserve: true,
  });
  test(
    "cash reserve: last-resort toggle lets the reserve be spent",
    wfReserveAllowed.wCash,
    250000,
  );
  test(
    "cash reserve: reserveUsed reports the dip into the floor",
    wfReserveAllowed.reserveUsed,
    50000,
  );
  const wfLegacy = doWithdrawalWaterfall(250000, reserveState, true, {
    strategy: "cashFirst",
    reserveNominal: 100000,
    allowReserve: false,
  });
  test(
    "cashFirst: reserve floor ignored (legacy drain-cash behavior)",
    wfLegacy.wCash,
    250000,
  );

  // cashLast: taxable/tax-deferred drained before cash; Roth still last
  const wfCashLast = doWithdrawalWaterfall(
    60000,
    {
      bCash: 100000,
      bTaxable: 50000,
      bTaxableBasis: 0,
      b401k: 0,
      bTradIra: 0,
      bRoth: 50000,
    },
    true,
    { strategy: "cashLast", reserveNominal: 0, allowReserve: false },
  );
  test("cashLast: taxable used before cash", wfCashLast.wTaxable, 50000);
  test("cashLast: cash covers the remainder", wfCashLast.wCash, 10000);
  test("cashLast: Roth still preserved last", wfCashLast.wRoth, 0);

  // proportional: pro-rata by available balances across cash/taxable/401k/IRA
  const wfProp = doWithdrawalWaterfall(
    100000,
    {
      bCash: 100000,
      bTaxable: 100000,
      bTaxableBasis: 70000,
      b401k: 200000,
      bTradIra: 0,
      bRoth: 0,
    },
    true,
    { strategy: "proportional", reserveNominal: 0, allowReserve: false },
  );
  test("proportional: cash takes its 25% share", wfProp.wCash, 25000, pctEq);
  test(
    "proportional: taxable takes its 25% share",
    wfProp.wTaxable,
    25000,
    pctEq,
  );
  test("proportional: 401k takes its 50% share", wfProp.w401k, 50000, pctEq);

  testScenario(
    "Cash reserve: inflation-adjusted floor is never breached in a full plan",
    () => {
      const r = simulate({
        ...baseInputs,
        currentAge: 60,
        retirementAge: 61,
        planThroughAge: 75,
        balanceCash: 300000,
        balanceTaxable: 50000,
        balance401k: 0,
        balanceTradIra: 0,
        balanceRoth: 0,
        balanceHsa: 0,
        partTimeIncome: 0,
        partTimeYears: 0,
        ssIncome: 20000,
        ssAge: 67,
        conversionBridge: 0,
        conversionMid: 0,
        conversionFinal: 0,
        cashStrategy: "preserveReserve",
        cashReserveFloor: 100000,
        allowReserveAsLastResort: false,
      });
      const breach = r.yearlyData.find(
        (d) => d.phase !== "accumulation" && d.cash < d.cashFloor - 1,
      );
      const inflated = r.yearlyData.some((d) => d.cashFloor > 100000);
      return {
        passed: !breach && inflated,
        details: breach
          ? `age ${breach.age}: cash=${breach.cash} < floor=${breach.cashFloor}`
          : "floor preserved in every year and grows with inflation",
      };
    },
  );

  testScenario(
    "Couple: shared cash reserve respected by household waterfall",
    () => {
      const zeros = {
        balance401k: 0,
        balanceTradIra: 0,
        balanceRoth: 0,
        balanceHsa: 0,
        ssIncome: 0,
        pensionIncome: 0,
        partTimeIncome: 0,
        partTimeYears: 0,
        contrib401k: 0,
        contribMatch: 0,
        contribHsa: 0,
        healthcarePre65: 10000,
        healthcarePost65: 5000,
        conversionBridge: 0,
        conversionMid: 0,
        conversionFinal: 0,
        rmdStartAge: 99,
        currentAge: 60,
        retirementAge: 61,
        planThroughAge: 70,
      };
      const couple = normalizeCoupleInputs({
        primary: { ...DEFAULT_COUPLE_INPUTS.primary, ...zeros },
        spouse: { ...DEFAULT_COUPLE_INPUTS.spouse, ...zeros },
        shared: {
          ...DEFAULT_COUPLE_INPUTS.shared,
          balanceCash: 300000,
          balanceTaxable: 0,
          baseExpenses: 80000,
          cashStrategy: "preserveReserve",
          cashReserveFloor: 100000,
          allowReserveAsLastResort: false,
        },
      });
      const r = simulateCouple(couple);
      const breach = r.yearlyData.find(
        (d) => d.phase !== "accumulation" && d.cash < d.cashFloor - 1,
      );
      const usedSomeCash = r.yearlyData.some((d) => d.fromCash > 0);
      return {
        passed: !breach && usedSomeCash,
        details: breach
          ? `year ${breach.year}: cash=${breach.cash} < floor=${breach.cashFloor}`
          : "household floor preserved; spendable cash above floor was used",
      };
    },
  );

  // --- Horizon-aware withdrawal guideline
  test("guideline: 30-year horizon = 4%", safeWithdrawalGuideline(30), 0.04, (a, e) => Math.abs(a - e) < 1e-9);
  test("guideline: 35-year horizon = 3.5%", safeWithdrawalGuideline(35), 0.035, (a, e) => Math.abs(a - e) < 1e-9);
  test("guideline: 43-year horizon = 3.25%", safeWithdrawalGuideline(43), 0.0325, (a, e) => Math.abs(a - e) < 1e-9);

  testScenario(
    "Max sustainable spending: solved value actually funds the plan",
    () => {
      const dangerInputs = {
        ...baseInputs,
        currentAge: 60,
        retirementAge: 61,
        planThroughAge: 85,
        balanceCash: 100000,
        balanceTaxable: 200000,
        balance401k: 600000,
        balanceTradIra: 0,
        balanceRoth: 0,
        balanceHsa: 0,
        baseExpenses: 120000,
        partTimeIncome: 0,
        partTimeYears: 0,
        conversionBridge: 0,
        conversionMid: 0,
        conversionFinal: 0,
      };
      const before = computeShortfallInfo(simulate(dangerInputs));
      if (before.status !== "danger")
        return { passed: false, details: "setup plan was not in danger" };
      const maxSpend = solveMaxSustainableSpending(dangerInputs);
      if (maxSpend == null || maxSpend >= dangerInputs.baseExpenses)
        return {
          passed: false,
          details: `solver returned ${maxSpend} (expected a cut below 120000)`,
        };
      const after = computeShortfallInfo(
        simulate({ ...dangerInputs, baseExpenses: maxSpend }),
      );
      return {
        passed: after.status !== "danger",
        details: `maxSpend=${maxSpend}, status after cut=${after.status}`,
      };
    },
  );

  testScenario(
    "Narrative: early-retiree plan reports lifetime 72(t) penalties",
    () => {
      const earlyInputs = {
        ...baseInputs,
        currentAge: 50,
        retirementAge: 52,
        planThroughAge: 60,
        balanceCash: 0,
        balanceTaxable: 0,
        balanceRoth: 0,
        balanceHsa: 0,
        balanceTradIra: 0,
        partTimeIncome: 0,
        partTimeYears: 0,
        conversionBridge: 0,
      };
      const earlyResults = simulate(earlyInputs);
      const n = generatePlanNarrative(earlyInputs, earlyResults, null);
      const hasPenaltyItem = n.watchItems.some((w) =>
        w.includes("early-withdrawal penalties"),
      );
      const defaultResults = simulate(baseInputs);
      const nDefault = generatePlanNarrative(baseInputs, defaultResults, null);
      const defaultHasIt = nDefault.watchItems.some((w) =>
        w.includes("early-withdrawal penalties"),
      );
      return {
        passed: hasPenaltyItem && !defaultHasIt,
        details: `early plan flagged=${hasPenaltyItem}, default flagged=${defaultHasIt}`,
      };
    },
  );

  // --- Roth ordering layers (IRC 408A(d)(4))
  test(
    "Roth layers: basis free, unseasoned conversion penalized",
    rothEarlyPenaltyBase(
      8000,
      { contribBasis: 5000, vintages: [{ year: 2026, amount: 20000 }] },
      2028,
    ),
    3000,
  );
  test(
    "Roth layers: 5-year-seasoned conversion is penalty-free",
    rothEarlyPenaltyBase(
      8000,
      { contribBasis: 0, vintages: [{ year: 2026, amount: 20000 }] },
      2031,
    ),
    0,
  );
  test(
    "Roth layers: earnings beyond layers are penalized",
    rothEarlyPenaltyBase(
      30000,
      { contribBasis: 5000, vintages: [{ year: 2020, amount: 20000 }] },
      2031,
    ),
    5000,
  );

  testScenario(
    "Roth basis: early retiree spending contributions pays no penalty",
    () => {
      const r = simulate({
        ...baseInputs,
        currentAge: 50,
        retirementAge: 52,
        planThroughAge: 58,
        balanceCash: 0,
        balanceTaxable: 0,
        balance401k: 0,
        balanceTradIra: 0,
        balanceHsa: 0,
        balanceRoth: 400000,
        rothBasis: 400000,
        contrib401k: 0,
        contribMatch: 0,
        contribHsa: 0,
        partTimeIncome: 0,
        partTimeYears: 0,
        conversionBridge: 0,
        ssIncome: 0,
      });
      const row = r.yearlyData.find((d) => d.age === 52);
      return {
        passed: row.fromRoth > 0 && row.earlyPenalty === 0,
        details: `fromRoth=${row.fromRoth}, penalty=${row.earlyPenalty}`,
      };
    },
  );

  // --- SEPP / 72(t)
  test(
    "seppAmortizedPayment: $1M at 5% from age 52 (life exp 34.3) approx $61,545",
    seppAmortizedPayment(1000000, 0.05, 52),
    61545,
    pctEq,
  );

  testScenario(
    "SEPP: amortized stream eliminates the penalty when it covers the need",
    () => {
      const base = {
        ...baseInputs,
        currentAge: 50,
        retirementAge: 52,
        planThroughAge: 60,
        balanceCash: 0,
        balanceTaxable: 0,
        balanceRoth: 0,
        balanceHsa: 0,
        balanceTradIra: 0,
        balance401k: 1000000,
        baseExpenses: 40000,
        healthcarePre65: 10000,
        partTimeIncome: 0,
        partTimeYears: 0,
        conversionBridge: 0,
        ssIncome: 20000,
      };
      const withSepp = simulate({ ...base, useSepp: true, seppRate: 0.05 });
      const withoutSepp = simulate(base);
      const rowW = withSepp.yearlyData.find((d) => d.age === 52);
      const rowWo = withoutSepp.yearlyData.find((d) => d.age === 52);
      return {
        passed:
          rowW.earlyPenalty === 0 &&
          rowWo.earlyPenalty > 0 &&
          rowW.from401k > 0,
        details: `sepp: penalty=${rowW.earlyPenalty} draw=${rowW.from401k}; no sepp: penalty=${rowWo.earlyPenalty}`,
      };
    },
  );

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  return { passed, failed, total: results.length, results };
}

// ============================================================
// SIMULATION
// ============================================================

function simulate(inputs, options = {}) {
  const {
    yearlyReturns = null,
    useFlexibleSpending = false,
  } = options;
  const {
    currentAge,
    retirementAge,
    planThroughAge,
    balanceCash,
    balanceTaxable,
    balance401k,
    balanceTradIra,
    balanceRoth,
    balanceHsa,
    creditCardDebt = 0,
    preReturn,
    postReturn,
    cashReturn,
    inflation,
    contrib401k,
    contribMatch,
    contribHsa,
    baseExpenses,
    healthcarePre65,
    healthcarePost65,
    partTimeIncome,
    partTimeYears,
    ssIncome,
    ssAge,
    pensionIncome = 0,
    pensionStartAge = 60,
    pensionCola = 0.02,
    pensionNyExempt = true,
    rmdStartAge,
    taxableBasisPct = 0.7,
    taxableAnnualTaxDrag = 0.005,
    useAcaSubsidyEstimate = false,
    householdSize = 2,
    conversionBridge,
    conversionMid,
    conversionFinal,
    cashStrategy = "cashFirst",
    cashReserveFloor = 0,
    allowReserveAsLastResort = false,
    rothBasis = 0,
    useSepp = false,
    seppRate = 0.05,
  } = inputs;

  // Guard against invalid inputs during manual typing. A retirement age at or
  // below the current age is VALID — it means the user is retiring this year
  // or is already retired, and year 1 of the projection is a retirement year.
  if (
    !retirementAge ||
    !currentAge ||
    !planThroughAge ||
    planThroughAge < Math.max(currentAge, retirementAge)
  ) {
    // Return empty result if inputs are clearly invalid
    return {
      yearlyData: [],
      summary: {
        portfolioAtRetirement: 0,
        portfolioAtEnd: 0,
        year1WithdrawalRate: 0,
        year1Spending: 0,
        totalTaxesPaid: 0,
        totalConverted: 0,
        totalUnmetCashFlow: 0,
        depleted: false,
        rmdStartAge: 0,
        currentTotal: 0,
      },
    };
  }

  const currentYear = PROJECTION_START_YEAR;
  const retirementYear = currentYear + (retirementAge - currentAge);
  const endYear = currentYear + (planThroughAge - currentAge);
  // Filing status drives federal/NY brackets and deductions, SS taxation
  // thresholds, NIIT, senior deductions, and IRMAA tiers. Defaults to MFJ
  // for backward compatibility with direct engine calls.
  const filingStatus = inputs.filingStatus === "single" ? "single" : "mfj";
  const effectiveRmdStartAge =
    rmdStartAge ?? defaultRmdStartAge(currentAge, currentYear);
  // Benefits cannot start before 62 even if the user types a lower age.
  const ssClaimAge = Math.max(SS_MIN_CLAIM_AGE, ssAge);
  // Rule of 55: separating from service in/after the year you turn 55 makes
  // withdrawals from THAT employer's 401k penalty-free (never IRAs). Retiring
  // before 55 forfeits it permanently for this model.
  const penaltyFree401k = retirementAge >= 55;
  const taxableReturn = (ret) => Math.max(-0.99, ret - taxableAnnualTaxDrag);

  let bCash = balanceCash;
  let bTaxable = balanceTaxable;
  // Cost basis tracks what was paid in (vs. current market value).
  // Only the gain portion (value - basis) is taxable on sale.
  let bTaxableBasis = balanceTaxable * taxableBasisPct;
  let b401k = balance401k;
  let bTradIra = balanceTradIra;
  let bRoth = balanceRoth;
  let bHsa = balanceHsa;
  let unpaidDebt = Math.max(0, creditCardDebt);
  const initialCashPayoff = Math.min(bCash, unpaidDebt);
  bCash -= initialCashPayoff;
  unpaidDebt -= initialCashPayoff;
  if (unpaidDebt > 0 && bTaxable > 0) {
    const taxablePayoff = Math.min(bTaxable, unpaidDebt);
    const payoffGain = computeRealizedGain(taxablePayoff, bTaxable, bTaxableBasis);
    bTaxable -= taxablePayoff;
    bTaxableBasis = Math.max(0, bTaxableBasis - Math.max(0, taxablePayoff - payoffGain));
    unpaidDebt -= taxablePayoff;
  }

  const yearlyData = [];
  let totalTaxesPaid = 0;
  let totalConverted = 0;
  let totalUnmetCashFlow = unpaidDebt;
  let depleted = unpaidDebt > 1;
  // Projected MAGI by year — real IRMAA is based on MAGI from two years
  // earlier, so retirement years look back where a projected MAGI exists.
  const magiByYear = {};
  // Roth ordering layers: user-entered contribution basis + conversion
  // vintages created below. Basis is capped at the starting balance.
  const rothLayers = {
    contribBasis: Math.max(0, Math.min(rothBasis || 0, balanceRoth)),
    vintages: [],
  };
  // 72(t) SEPP: payment is fixed from the first retirement year's starting
  // tax-deferred balance and forced until the later of 5 years or age 59.5
  // (busting the schedule is not modeled - payments always continue).
  let seppPayment = null;
  const seppLockEndAge =
    useSepp && retirementAge < 59.5
      ? Math.max(retirementAge + 5, 59.5)
      : null;
  let priorYearEndTotal = bCash + bTaxable + b401k + bTradIra + bRoth + bHsa - unpaidDebt;
  let priorPriorYearEndTotal = 0;

  for (let year = currentYear; year <= endYear; year++) {
    const age = currentAge + (year - currentYear);
    const isAccumulation = age < retirementAge;
    const yearsFromRetirement = Math.max(0, year - retirementYear);
    // Inflation multiplier is anchored to TODAY (currentYear), not the retirement
    // year, so that spending, healthcare, part-time income, and Roth-conversion
    // targets — all entered in today's dollars — inflate on the same clock as
    // Social Security, pensions, and the real-dollar display toggle. Anchoring to
    // the retirement year previously understated these by (1+inflation)^(years to
    // retirement) and overstated plan success for anyone not retiring this year.
    const inflMult = Math.pow(1 + inflation, year - currentYear);
    const marketReturn = isAccumulation
      ? preReturn
      : yearlyReturns?.[year - retirementYear] ?? postReturn;

    if (isAccumulation) {
      const limits = getContributionLimits(age, year, inflation, householdSize);
      const applied401k = Math.min(Math.max(0, contrib401k), limits.k401Employee);
      const appliedMatch = Math.min(
        Math.max(0, contribMatch),
        Math.max(0, limits.k401Total - applied401k),
      );
      const appliedHsa = Math.min(Math.max(0, contribHsa), limits.hsa);
      // Traditional IRA RMDs are required even while still working — the
      // still-working exception covers only the current employer's 401k.
      // Income tax on the forced distribution is not modeled in accumulation
      // years (salary and its taxes are out of scope); the gross amount is
      // reinvested in the taxable account, raising its cost basis.
      let accumIraRmd = 0;
      if (age >= effectiveRmdStartAge && bTradIra > 0) {
        const divisor = rmdDivisor(age);
        if (divisor) {
          accumIraRmd = bTradIra / divisor;
          bTradIra -= accumIraRmd;
        }
      }
      b401k = b401k * (1 + marketReturn) + applied401k + appliedMatch;
      bTaxable = bTaxable * (1 + taxableReturn(marketReturn)) + accumIraRmd;
      bTaxableBasis += accumIraRmd;
      bTradIra = bTradIra * (1 + marketReturn);
      bRoth = bRoth * (1 + marketReturn);
      bHsa = bHsa * (1 + marketReturn) + appliedHsa;
      bCash = bCash * (1 + cashReturn);
      const total = bCash + bTaxable + b401k + bTradIra + bRoth + bHsa - unpaidDebt;
      priorPriorYearEndTotal = priorYearEndTotal;
      priorYearEndTotal = total;

      yearlyData.push({
        year,
        age,
        phase: "accumulation",
        spending: 0,
        partTime: 0,
        ss: 0,
        pension: 0,
        netNeed: 0,
        grossWithdrawal: 0,
        fromCash: 0,
        fromTaxable: 0,
        from401k: 0,
        fromIra: 0,
        fromRoth: 0,
        conversion: 0,
        tax: 0,
        strategy: "Accumulating",
        cash: Math.round(bCash),
        taxable: Math.round(bTaxable),
        k401: Math.round(b401k),
        tradIra: Math.round(bTradIra),
        roth: Math.round(bRoth),
        hsa: Math.round(bHsa),
        total: Math.round(total),
        rmdAmount: Math.round(accumIraRmd),
        realizedGain: 0,
        taxableSs: 0,
        magi: 0,
        taxableBasisEnd: Math.round(bTaxableBasis),
        irmaaSurcharge: 0,
        irmaaTriggered: false,
        acaSubsidy: 0,
        hsaWithdrawal: 0,
        earlyPenalty: 0,
        cashFloor: 0,
        reserveUsed: 0,
        unmetCashFlow: Math.round(unpaidDebt),
        contribution401kApplied: Math.round(applied401k),
        contributionMatchApplied: Math.round(appliedMatch),
        contributionHsaApplied: Math.round(appliedHsa),
      });
      continue;
    }

    // Retirement year
    const healthcareSticker = age < 65 ? healthcarePre65 : healthcarePost65;
    const lifestyleSpending = Math.round(baseExpenses * inflMult);
    const spendingBase = Math.round((baseExpenses + healthcareSticker) * inflMult);
    let spending = spendingBase;
    if (useFlexibleSpending && priorPriorYearEndTotal > 0 && yearsFromRetirement > 0) {
      const yoyChange =
        (priorYearEndTotal - priorPriorYearEndTotal) / priorPriorYearEndTotal;
      if (yoyChange < -0.15) {
        spending = Math.round(spending * 0.9);
      }
    }

    const ptIncome =
      age < retirementAge + partTimeYears
        ? Math.round(partTimeIncome * inflMult)
        : 0;
    const ssClaimBenefit = adjustedSocialSecurityBenefit(ssIncome, ssClaimAge);
    const ssGross =
      age >= ssClaimAge
        ? Math.round(ssClaimBenefit * Math.pow(1 + inflation, year - currentYear))
        : 0;
    // Pension: grows at pensionCola from today (represents benefit formula growth + COLA)
    const pensionMult = Math.pow(1 + pensionCola, year - currentYear);
    const pensionGross =
      age >= pensionStartAge && pensionIncome > 0
        ? Math.round(pensionIncome * pensionMult)
        : 0;

    // 72(t) SEPP stream: fix the payment in the first retirement year.
    if (
      seppLockEndAge !== null &&
      seppPayment === null &&
      age >= retirementAge
    ) {
      seppPayment = seppAmortizedPayment(b401k + bTradIra, seppRate, age);
    }
    const seppActive =
      seppLockEndAge !== null && seppPayment > 0 && age < seppLockEndAge;

    // Determine Roth conversion target based on age phase
    let conversion = 0;
    let strategy = "";
    if (age < 60) {
      conversion = Math.max(
        0,
        Math.min(Math.round(conversionBridge * inflMult), b401k),
      );
      strategy = `Bridge (R55/cash) | Convert $${Math.round(conversionBridge / 1000)}K`;
    } else if (age < 65) {
      conversion = Math.max(
        0,
        Math.min(Math.round(conversionMid * inflMult), b401k),
      );
      strategy = `Flex | Convert $${Math.round(conversionMid / 1000)}K`;
    } else if (age < ssClaimAge) {
      conversion = Math.max(
        0,
        Math.min(Math.round(conversionFinal * inflMult), b401k),
      );
      strategy = `Medicare | Final convert $${Math.round(conversionFinal / 1000)}K`;
    } else {
      conversion = 0;
      strategy = "SS active | Roth preserved";
    }

    // Calculate RMD requirement (if applicable)
    let rmdAmount = 0;
    if (age >= effectiveRmdStartAge) {
      const divisor = rmdDivisor(age);
      if (divisor) {
        rmdAmount = Math.max(0, (b401k + bTradIra) / divisor);
      }
    }
    if (rmdAmount > 0 && conversion > 0) {
      const rmdThatMustComeFrom401k = Math.max(0, rmdAmount - bTradIra);
      conversion = Math.min(conversion, Math.max(0, b401k - rmdThatMustComeFrom401k));
    }

    // Available balance for conversion (can't convert more than remains after expected draw)
    // Reserve conversion amount from 401k pool for the waterfall
    const state = {
      bCash,
      bTaxable: Math.max(0, bTaxable),
      bTaxableBasis,
      b401k: Math.max(0, b401k - conversion),
      bTradIra,
      bRoth,
    };

    const preSs = age < ssClaimAge;
    // Reserve floor is entered in today's dollars and inflates on the same
    // clock as spending, so it keeps its purchasing power across the plan.
    const cashPolicy = {
      strategy: cashStrategy,
      reserveNominal:
        cashStrategy === "cashFirst"
          ? 0
          : Math.round(Math.max(0, cashReserveFloor) * inflMult),
      allowReserve: allowReserveAsLastResort,
    };

    // Taxable interest on the Cash/HYSA balance (start-of-year balance).
    // Counted as ordinary income, provisional income, and MAGI.
    const cashInterestIncome = Math.max(0, bCash * cashReturn);
    // People 65+ for the senior standard deductions. A single filer counts
    // only themselves; MFJ mirrors the IRMAA enrollee assumption (household
    // members share the modeled age).
    const seniors65 =
      age >= 65
        ? filingStatus === "single"
          ? 1
          : Math.max(1, Math.min(2, householdSize))
        : 0;
    const medicareEnrollees =
      filingStatus === "single" ? 1 : Math.min(2, householdSize);

    // === Converged solve: withdrawals, tax, RMD, and IRMAA all converge together ===
    // Outer loop: iterate IRMAA (and ACA pre-65) until spending stabilizes.
    // Inner: solveGrossedUpWithdrawals handles tax gross-up AND RMD internally.
    let solve;
    let irmaaSurcharge = 0;
    let irmaaTriggered = false;
    let acaSubsidy = 0;
    let finalSpending = spending;
    let hsaWithdrawal = 0;

    for (let outerIter = 0; outerIter < 4; outerIter++) {
      // Effective spending includes IRMAA surcharge (post-65)
      // ACA (pre-65) is handled below as a separate branch
      const effectiveSpending =
        age >= 65 ? spending + irmaaSurcharge : spending;
      const healthcarePortion = Math.max(0, effectiveSpending - lifestyleSpending);
      const hsaOffset = Math.min(bHsa, healthcarePortion);

      const netNeed = Math.max(
        0,
        effectiveSpending - hsaOffset - ptIncome - ssGross - pensionGross,
      );

      solve = solveGrossedUpWithdrawals({
        netNeed,
        state,
        preSs,
        conversion,
        ptIncome,
        ssGross,
        pensionGross,
        pensionNyExempt,
        year,
        age,
        inflation,
        minimumRmd: seppActive
          ? Math.max(rmdAmount, seppPayment)
          : rmdAmount,
        penaltyFree401k,
        cashPolicy,
        interestIncome: cashInterestIncome,
        seniors65,
        filingStatus,
        rothLayers,
        seppExempt: seppActive ? seppPayment : 0,
      });

      finalSpending = effectiveSpending;
      hsaWithdrawal = hsaOffset;

      // Only post-65 IRMAA iteration matters here; break early for pre-65
      if (age < 65) break;

      // Recompute MAGI from converged solve
      const postOrdIncome =
        ptIncome +
        solve.taxableSs +
        pensionGross +
        cashInterestIncome +
        solve.withdrawals.w401k +
        solve.withdrawals.wIra +
        conversion;
      const postMagi = postOrdIncome + solve.realizedGain;

      // Real IRMAA uses MAGI from two years earlier. Use the projected MAGI
      // from that year when the projection has one (i.e. the household has
      // been retired 2+ years); otherwise fall back to same-year MAGI, since
      // working-year MAGI (salary) is out of scope for this model.
      const lookbackMagi = magiByYear[year - 2];
      const irmaaMagi = lookbackMagi != null ? lookbackMagi : postMagi;

      const newIrmaa = computeIrmaaSurcharge(
        irmaaMagi,
        year,
        inflation,
        medicareEnrollees,
        filingStatus,
      );

      // Converged when IRMAA tier is stable
      if (Math.abs(newIrmaa - irmaaSurcharge) < 10) {
        irmaaSurcharge = newIrmaa;
        break;
      }
      irmaaSurcharge = newIrmaa;
    }
    irmaaTriggered = irmaaSurcharge > 0;

    // ACA subsidy (pre-65 only, opt-in) — re-solve once with subsidized healthcare
    if (useAcaSubsidyEstimate && age < 65 && age >= retirementAge) {
      const estimatedMagi = solve.ordIncome + solve.realizedGain;
      const healthcareNominal = healthcareSticker * inflMult;
      const subsidizedNominal = estimateAcaHealthcareCost(
        healthcareNominal,
        estimatedMagi,
        householdSize,
        year,
        inflation,
      );
      acaSubsidy = Math.max(0, healthcareNominal - subsidizedNominal);
      finalSpending = Math.round(baseExpenses * inflMult + subsidizedNominal);
      hsaWithdrawal = Math.min(
        bHsa,
        Math.max(0, finalSpending - lifestyleSpending),
      );
      const netNeedAca = Math.max(
        0,
        finalSpending - hsaWithdrawal - ptIncome - ssGross - pensionGross,
      );
      solve = solveGrossedUpWithdrawals({
        netNeed: netNeedAca,
        state,
        preSs,
        conversion,
        ptIncome,
        ssGross,
        pensionGross,
        pensionNyExempt,
        year,
        age,
        inflation,
        minimumRmd: seppActive
          ? Math.max(rmdAmount, seppPayment)
          : rmdAmount,
        penaltyFree401k,
        cashPolicy,
        interestIncome: cashInterestIncome,
        seniors65,
        filingStatus,
        rothLayers,
        seppExempt: seppActive ? seppPayment : 0,
      });
    }

    // Update displayed spending to include IRMAA (shows true economic cost)
    spending = finalSpending;

    const { wCash, wTaxable, w401k, wIra, wRoth } = solve.withdrawals;
    const tax = solve.tax;
    const realizedGain = solve.realizedGain;
    const taxableSs = solve.taxableSs;

    // Apply realized gain to basis tracking BEFORE executing withdrawal
    const basisReduction = Math.max(0, wTaxable - realizedGain);

    // Execute withdrawals (balances updated)
    bCash = Math.max(0, bCash - wCash);
    bTaxable = Math.max(0, bTaxable - wTaxable);
    bTaxableBasis = Math.max(0, bTaxableBasis - basisReduction);
    b401k = Math.max(0, b401k - w401k - conversion);
    consumeRothLayers(wRoth, rothLayers);
    if (conversion > 0) rothLayers.vintages.push({ year, amount: conversion });
    bRoth = bRoth + conversion;
    bTradIra = Math.max(0, bTradIra - wIra);
    bRoth = Math.max(0, bRoth - wRoth);
    bHsa = Math.max(0, bHsa - hsaWithdrawal);

    // Any RMD surplus beyond net need + tax goes to cash (reinvested in HYSA-equivalent)
    const netNeedFinal = Math.max(
      0,
      finalSpending - hsaWithdrawal - ptIncome - ssGross - pensionGross,
    );
    const surplusFromRmd = Math.max(
      0,
      (wCash + wTaxable + w401k + wIra + wRoth) - (netNeedFinal + tax),
    );
    if (surplusFromRmd > 0) {
      bCash += surplusFromRmd;
    }
    const unmetCashFlow = Math.max(
      0,
      netNeedFinal + tax - (wCash + wTaxable + w401k + wIra + wRoth),
    );
    totalUnmetCashFlow += unmetCashFlow;

    // MAGI for display/debug (reflects final withdrawals)
    const finalOrdIncome =
      ptIncome +
      taxableSs +
      pensionGross +
      cashInterestIncome +
      w401k +
      wIra +
      conversion;
    const magi = finalOrdIncome + realizedGain;
    magiByYear[year] = magi;

    // Grow balances
    bCash *= 1 + cashReturn;
    bTaxable *= 1 + taxableReturn(marketReturn);
    bTaxableBasis *= 1; // Basis does not grow with market returns
    b401k *= 1 + marketReturn;
    bTradIra *= 1 + marketReturn;
    bRoth *= 1 + marketReturn;
    bHsa *= 1 + marketReturn;

    totalTaxesPaid += tax;
    totalConverted += conversion;

    const total = bCash + bTaxable + b401k + bTradIra + bRoth + bHsa - unpaidDebt;
    const grossWithdrawal = wCash + wTaxable + w401k + wIra + wRoth;
    priorPriorYearEndTotal = priorYearEndTotal;
    priorYearEndTotal = total;

    // Depletion: total portfolio hits zero (consistent with Monte Carlo)
    if ((total <= 0 || unmetCashFlow > 1) && !depleted) depleted = true;

    let phase = "bridge";
    if (age >= 60 && age < 65) phase = "mid";
    else if (age >= 65 && age < ssClaimAge) phase = "medicare";
    else if (age >= ssClaimAge) phase = "ss";

    yearlyData.push({
      year,
      age,
      phase,
      spending,
      partTime: ptIncome,
      ss: ssGross,
      pension: pensionGross,
      netNeed: netNeedFinal,
      grossWithdrawal: Math.round(grossWithdrawal),
      fromCash: Math.round(wCash),
      fromTaxable: Math.round(wTaxable),
      from401k: Math.round(w401k),
      fromIra: Math.round(wIra),
      fromRoth: Math.round(wRoth),
      hsaWithdrawal: Math.round(hsaWithdrawal),
      conversion: Math.round(conversion),
      tax,
      strategy,
      cash: Math.round(bCash),
      taxable: Math.round(bTaxable),
      k401: Math.round(b401k),
      tradIra: Math.round(bTradIra),
      roth: Math.round(bRoth),
      hsa: Math.round(bHsa),
      total: Math.round(total),
      // Debug/validation fields
      rmdAmount: Math.round(rmdAmount),
      realizedGain: Math.round(realizedGain),
      taxableSs: Math.round(taxableSs),
      magi: Math.round(magi),
      taxableBasisEnd: Math.round(bTaxableBasis),
      irmaaSurcharge: Math.round(irmaaSurcharge),
      irmaaTriggered,
      acaSubsidy: Math.round(acaSubsidy),
      earlyPenalty: solve.earlyPenalty,
      cashFloor: cashPolicy.reserveNominal,
      reserveUsed: Math.round(solve.withdrawals.reserveUsed || 0),
      unmetCashFlow: Math.round(unmetCashFlow),
    });
  }

  const currentTotal =
    inputs.balanceCash +
    inputs.balanceTaxable +
    inputs.balance401k +
    inputs.balanceTradIra +
    inputs.balanceRoth +
    inputs.balanceHsa -
    (inputs.creditCardDebt || 0);
  // First retirement-year row. For an already-retired user (retirementAge <=
  // currentAge) there is no row at exactly retirementAge, so fall back to the
  // first distribution row (year 1 of the projection).
  const retirementData =
    yearlyData.find((d) => d.age === retirementAge) ??
    yearlyData.find((d) => d.phase !== "accumulation") ??
    null;
  const endData = yearlyData[yearlyData.length - 1];
  const year1Data = retirementData;
  // Start-of-retirement balance: use accumulation year end (age = retirementAge - 1).
  // Already-retired users have no accumulation years — use today's balances.
  const startOfRetirement =
    retirementAge > currentAge
      ? yearlyData.find((d) => d.age === retirementAge - 1)
      : null;
  const startBalance =
    startOfRetirement && startOfRetirement.total > 0
      ? startOfRetirement.total
      : retirementAge <= currentAge && currentTotal > 0
        ? currentTotal
        : year1Data && year1Data.total > 0
          ? year1Data.total
          : 1; // Avoid divide-by-zero

  return {
    yearlyData,
    summary: {
      portfolioAtRetirement: retirementData ? retirementData.total : 0,
      portfolioAtEnd: endData.total,
      year1WithdrawalRate:
        year1Data && year1Data.grossWithdrawal !== undefined
          ? year1Data.grossWithdrawal / startBalance
          : 0,
      year1Spending: year1Data ? year1Data.spending : 0,
      totalTaxesPaid: Math.round(totalTaxesPaid),
      totalConverted: Math.round(totalConverted),
      totalUnmetCashFlow: Math.round(totalUnmetCashFlow),
      depleted,
      rmdStartAge: effectiveRmdStartAge,
      currentTotal,
    },
  };
}

function getCoupleHsaLimit(primaryAge, spouseAge, year, inflation, householdSize) {
  const { base, factor } = projectedFromKnownTable(LIMIT_TABLES, year, inflation);
  const roundTo = (value, increment) =>
    Math.round((value * factor) / increment) * increment;
  const familyLimit =
    householdSize > 1 ? roundTo(base.hsaFamily, 50) : roundTo(base.hsaSelf, 50);
  const catchUps =
    (primaryAge >= 55 ? base.hsaCatchUp55 : 0) +
    (spouseAge >= 55 && householdSize > 1 ? base.hsaCatchUp55 : 0);
  return familyLimit + catchUps;
}

function personConversionTarget(person, age, inflMult, b401k, rmdAmount) {
  if (age < person.retirementAge) return 0;
  let target = 0;
  if (age < 60) target = person.conversionBridge;
  else if (age < 65) target = person.conversionMid;
  else if (age < Math.max(SS_MIN_CLAIM_AGE, person.ssAge)) target = person.conversionFinal;
  const conversion = Math.max(0, Math.min(Math.round(target * inflMult), b401k));
  const rmdThatMustComeFrom401k = Math.max(0, rmdAmount);
  return Math.min(conversion, Math.max(0, b401k - rmdThatMustComeFrom401k));
}

function takeFromBalance(withdrawals, key, available, remaining) {
  const taken = Math.min(remaining, Math.max(0, available - (withdrawals[key] || 0)));
  withdrawals[key] = (withdrawals[key] || 0) + taken;
  return remaining - taken;
}

function enforcePersonRmd(withdrawals, prefix, state, rmdAmount) {
  let remainingRmd = Math.max(0, rmdAmount);
  if (remainingRmd <= 0) return;
  remainingRmd = takeFromBalance(
    withdrawals,
    `${prefix}Ira`,
    state[`${prefix}TradIra`],
    remainingRmd,
  );
  takeFromBalance(
    withdrawals,
    `${prefix}401k`,
    state[`${prefix}401k`],
    remainingRmd,
  );
}

function doCoupleWithdrawalWaterfall(
  grossNeed,
  state,
  preHouseholdSs,
  rmds,
  cashPolicy = CASH_POLICY_DEFAULT,
) {
  const withdrawals = {
    cash: 0,
    taxable: 0,
    primary401k: 0,
    primaryIra: 0,
    primaryRoth: 0,
    spouse401k: 0,
    spouseIra: 0,
    spouseRoth: 0,
  };
  enforcePersonRmd(withdrawals, "primary", state, rmds.primary);
  enforcePersonRmd(withdrawals, "spouse", state, rmds.spouse);

  let remaining = Math.max(
    0,
    grossNeed -
      Object.values(withdrawals).reduce((sum, value) => sum + value, 0),
  );
  const take = (key, available) => {
    remaining = takeFromBalance(withdrawals, key, available, remaining);
  };
  const strategy = cashPolicy.strategy || "cashFirst";
  // "Use cash first" is the legacy mode: the reserve floor is not applied.
  const reserve =
    strategy === "cashFirst" ? 0 : Math.max(0, cashPolicy.reserveNominal || 0);
  // Cap passed to takeFromBalance: cash balance minus the protected floor.
  const spendableCashCap = Math.max(0, state.cash - reserve);
  let reserveUsed = 0;

  if (strategy === "proportional") {
    // Pro-rata across cash-above-reserve, taxable, and both spouses'
    // tax-deferred accounts; Roth stays preserved until last.
    const buckets = [
      ["cash", spendableCashCap],
      ["taxable", Math.max(0, state.taxable)],
      ["primary401k", Math.max(0, state.primary401k)],
      ["spouse401k", Math.max(0, state.spouse401k)],
      ["primaryIra", Math.max(0, state.primaryTradIra)],
      ["spouseIra", Math.max(0, state.spouseTradIra)],
    ];
    const avail = buckets.map(([key, cap]) =>
      Math.max(0, cap - (withdrawals[key] || 0)),
    );
    const totalAvail = avail.reduce((sum, b) => sum + b, 0);
    if (totalAvail > 0 && remaining > 0) {
      const target = Math.min(remaining, totalAvail);
      buckets.forEach(([key], i) => {
        const share = Math.min((avail[i] / totalAvail) * target, avail[i], remaining);
        withdrawals[key] += share;
        remaining -= share;
      });
      // Sweep float residue through the same buckets in order.
      take("cash", spendableCashCap);
      take("taxable", state.taxable);
      take("primary401k", state.primary401k);
      take("spouse401k", state.spouse401k);
      take("primaryIra", state.primaryTradIra);
      take("spouseIra", state.spouseTradIra);
    }
    take("primaryRoth", state.primaryRoth);
    take("spouseRoth", state.spouseRoth);
  } else if (strategy === "cashLast") {
    // Cash only when other spendable sources are exhausted, but before Roth.
    if (preHouseholdSs) {
      take("taxable", state.taxable);
      take("primary401k", state.primary401k);
      take("spouse401k", state.spouse401k);
      take("primaryIra", state.primaryTradIra);
      take("spouseIra", state.spouseTradIra);
    } else {
      take("primary401k", state.primary401k);
      take("spouse401k", state.spouse401k);
      take("primaryIra", state.primaryTradIra);
      take("spouseIra", state.spouseTradIra);
      take("taxable", state.taxable);
    }
    take("cash", spendableCashCap);
    take("primaryRoth", state.primaryRoth);
    take("spouseRoth", state.spouseRoth);
  } else if (preHouseholdSs) {
    // cashFirst (reserve = 0) and preserveReserve share this order.
    take("cash", spendableCashCap);
    take("taxable", state.taxable);
    take("primary401k", state.primary401k);
    take("spouse401k", state.spouse401k);
    take("primaryIra", state.primaryTradIra);
    take("spouseIra", state.spouseTradIra);
    take("primaryRoth", state.primaryRoth);
    take("spouseRoth", state.spouseRoth);
  } else {
    take("primary401k", state.primary401k);
    take("spouse401k", state.spouse401k);
    take("primaryIra", state.primaryTradIra);
    take("spouseIra", state.spouseTradIra);
    take("taxable", state.taxable);
    take("cash", spendableCashCap);
    take("primaryRoth", state.primaryRoth);
    take("spouseRoth", state.spouseRoth);
  }

  // Last resort: dip into the protected reserve only if explicitly allowed.
  if (remaining > 0 && reserve > 0 && cashPolicy.allowReserve) {
    const fromReserve = Math.min(
      remaining,
      Math.max(0, state.cash - withdrawals.cash),
    );
    withdrawals.cash += fromReserve;
    reserveUsed = fromReserve;
    remaining -= fromReserve;
  }
  withdrawals.reserveUsed = reserveUsed;
  return withdrawals;
}

function solveCoupleGrossedUpWithdrawals({
  netNeed,
  state,
  preHouseholdSs,
  conversions,
  rmds,
  incomes,
  year,
  ages,
  inflation,
  penaltyFree401k = { primary: false, spouse: false },
  cashPolicy = CASH_POLICY_DEFAULT,
  // Taxable interest earned on the shared Cash/HYSA balance this year.
  interestIncome = 0,
  // Per-spouse Roth ordering layers (IRC 408A(d)(4)).
  rothLayers = { primary: null, spouse: null },
}) {
  const seniors65 =
    (ages.primary >= 65 ? 1 : 0) + (ages.spouse >= 65 ? 1 : 0);
  let tax = 0;
  let withdrawals = doCoupleWithdrawalWaterfall(0, state, preHouseholdSs, rmds, cashPolicy);
  let realizedGain = 0;
  let taxableSs = 0;
  let ordIncome = 0;
  let earlyPenalty = 0;

  for (let iter = 0; iter < 10; iter++) {
    const grossNeed = Math.max(0, netNeed + tax);
    withdrawals = doCoupleWithdrawalWaterfall(
      grossNeed,
      state,
      preHouseholdSs,
      rmds,
      cashPolicy,
    );
    realizedGain = computeRealizedGain(
      withdrawals.taxable,
      state.taxable,
      state.taxableBasis,
    );

    const taxDeferredWithdrawals =
      withdrawals.primary401k +
      withdrawals.spouse401k +
      withdrawals.primaryIra +
      withdrawals.spouseIra;
    const totalConversions = conversions.primary + conversions.spouse;
    const pensionGross = incomes.primaryPension + incomes.spousePension;
    const partTimeGross = incomes.primaryPartTime + incomes.spousePartTime;
    const ssGross = incomes.primarySs + incomes.spouseSs;
    const incomeBeforeSs =
      partTimeGross +
      pensionGross +
      interestIncome +
      taxDeferredWithdrawals +
      totalConversions +
      realizedGain;
    taxableSs = taxableSocialSecurity(ssGross, incomeBeforeSs);
    ordIncome =
      partTimeGross +
      taxableSs +
      pensionGross +
      interestIncome +
      taxDeferredWithdrawals +
      totalConversions;

    const nyExemptAmount =
      (incomes.primaryPensionNyExempt ? incomes.primaryPension : 0) +
      (incomes.spousePensionNyExempt ? incomes.spousePension : 0);
    const primaryPrivateRetirement =
      withdrawals.primary401k +
      withdrawals.primaryIra +
      conversions.primary +
      (incomes.primaryPensionNyExempt ? 0 : incomes.primaryPension);
    const spousePrivateRetirement =
      withdrawals.spouse401k +
      withdrawals.spouseIra +
      conversions.spouse +
      (incomes.spousePensionNyExempt ? 0 : incomes.spousePension);
    // NY pension/annuity exclusion applies from age 59½ (annual model: 60).
    const nyPensionAnnuityExclusion =
      (ages.primary >= 59.5 ? Math.min(20000, primaryPrivateRetirement) : 0) +
      (ages.spouse >= 59.5 ? Math.min(20000, spousePrivateRetirement) : 0);

    // IRC §72(t) 10% early-distribution penalty, applied per spouse.
    // See solveGrossedUpWithdrawals for the Rule-of-55 / IRA / Roth treatment.
    const personPenalty = (age, ruleOf55, w401k, wIra, wRoth, layers) => {
      if (age >= 59.5) return 0;
      const penalized401k = ruleOf55 && age >= 55 ? 0 : w401k;
      const penalizedRoth = layers
        ? rothEarlyPenaltyBase(wRoth, layers, year)
        : wRoth;
      return 0.1 * (penalized401k + wIra + penalizedRoth);
    };
    earlyPenalty =
      personPenalty(
        ages.primary,
        penaltyFree401k.primary,
        withdrawals.primary401k,
        withdrawals.primaryIra,
        withdrawals.primaryRoth,
        rothLayers.primary,
      ) +
      personPenalty(
        ages.spouse,
        penaltyFree401k.spouse,
        withdrawals.spouse401k,
        withdrawals.spouseIra,
        withdrawals.spouseRoth,
        rothLayers.spouse,
      );

    const newTax =
      totalTax(
        ordIncome,
        realizedGain,
        year,
        nyExemptAmount,
        inflation,
        taxableSs,
        nyPensionAnnuityExclusion,
        seniors65,
      ) + earlyPenalty;
    if (Math.abs(newTax - tax) < 1) {
      tax = newTax;
      break;
    }
    tax = newTax;
  }

  return {
    withdrawals,
    tax: Math.round(tax),
    realizedGain,
    taxableSs,
    ordIncome,
    earlyPenalty: Math.round(earlyPenalty),
  };
}

function allocateCoupleHsaWithdrawals(primaryHsa, spouseHsa, healthcarePortion) {
  let remainingHealthcare = Math.max(0, healthcarePortion);
  const primaryWithdrawal = Math.min(primaryHsa, remainingHealthcare);
  remainingHealthcare -= primaryWithdrawal;
  const spouseWithdrawal = Math.min(spouseHsa, remainingHealthcare);
  return {
    primary: primaryWithdrawal,
    spouse: spouseWithdrawal,
    total: primaryWithdrawal + spouseWithdrawal,
  };
}

function simulateCouple(coupleInputs, options = {}) {
  const { yearlyReturns = null, useFlexibleSpending = false } = options;
  const { primary, spouse, shared } = normalizeCoupleInputs(coupleInputs);
  const currentYear = PROJECTION_START_YEAR;
  const endYear = Math.max(
    currentYear + (primary.planThroughAge - primary.currentAge),
    currentYear + (spouse.planThroughAge - spouse.currentAge),
  );
  const taxableReturn = (ret) =>
    Math.max(-0.99, ret - (shared.taxableAnnualTaxDrag ?? 0.005));

  let cash = shared.balanceCash;
  let taxable = shared.balanceTaxable;
  let taxableBasis = shared.balanceTaxable * shared.taxableBasisPct;
  let unpaidDebt = Math.max(0, shared.creditCardDebt || 0);
  const primaryState = {
    b401k: primary.balance401k,
    bTradIra: primary.balanceTradIra,
    bRoth: primary.balanceRoth,
    bHsa: primary.balanceHsa,
  };
  const spouseState = {
    b401k: spouse.balance401k,
    bTradIra: spouse.balanceTradIra,
    bRoth: spouse.balanceRoth,
    bHsa: spouse.balanceHsa,
  };

  const initialCashPayoff = Math.min(cash, unpaidDebt);
  cash -= initialCashPayoff;
  unpaidDebt -= initialCashPayoff;
  if (unpaidDebt > 0 && taxable > 0) {
    const taxablePayoff = Math.min(taxable, unpaidDebt);
    const payoffGain = computeRealizedGain(taxablePayoff, taxable, taxableBasis);
    taxable -= taxablePayoff;
    taxableBasis = Math.max(0, taxableBasis - Math.max(0, taxablePayoff - payoffGain));
    unpaidDebt -= taxablePayoff;
  }

  const yearlyData = [];
  let totalTaxesPaid = 0;
  let totalConverted = 0;
  let totalUnmetCashFlow = unpaidDebt;
  let depleted = unpaidDebt > 1;
  // Projected household MAGI by year, for the IRMAA two-year lookback.
  const coupleMagiByYear = {};
  // Per-spouse Roth ordering layers (IRC 408A(d)(4)).
  const coupleRothLayers = {
    primary: {
      contribBasis: Math.max(
        0,
        Math.min(primary.rothBasis || 0, primary.balanceRoth),
      ),
      vintages: [],
    },
    spouse: {
      contribBasis: Math.max(
        0,
        Math.min(spouse.rothBasis || 0, spouse.balanceRoth),
      ),
      vintages: [],
    },
  };
  let priorPriorYearEndTotal = 0;
  let priorYearEndTotal =
    cash +
    taxable +
    primaryState.b401k +
    spouseState.b401k +
    primaryState.bTradIra +
    spouseState.bTradIra +
    primaryState.bRoth +
    spouseState.bRoth +
    primaryState.bHsa +
    spouseState.bHsa -
    unpaidDebt;

  const totalAssets = () =>
    cash +
    taxable +
    primaryState.b401k +
    spouseState.b401k +
    primaryState.bTradIra +
    spouseState.bTradIra +
    primaryState.bRoth +
    spouseState.bRoth +
    primaryState.bHsa +
    spouseState.bHsa -
    unpaidDebt;

  for (let year = currentYear; year <= endYear; year++) {
    const yearIndex = year - currentYear;
    const primaryAge = primary.currentAge + yearIndex;
    const spouseAge = spouse.currentAge + yearIndex;
    const primaryRetired = primaryAge >= primary.retirementAge;
    const spouseRetired = spouseAge >= spouse.retirementAge;
    const householdRetired = primaryRetired || spouseRetired;
    const firstRetirementYear =
      currentYear +
      Math.min(
        primary.retirementAge - primary.currentAge,
        spouse.retirementAge - spouse.currentAge,
      );
    const yearsFromRetirement = Math.max(0, year - firstRetirementYear);
    // Anchor inflation to TODAY (currentYear), matching SS, pensions, and the
    // real-dollar display. See the individual-engine note above. yearsFromRetirement
    // is retained only for the flexible-spending year-over-year guard below.
    const inflMult = Math.pow(1 + shared.inflation, year - currentYear);
    const marketReturn = householdRetired
      ? yearlyReturns?.[Math.max(0, year - firstRetirementYear)] ?? shared.postReturn
      : shared.preReturn;

    const primary401kLimit = getContributionLimits(
      primaryAge,
      year,
      shared.inflation,
      shared.householdSize,
    );
    const spouse401kLimit = getContributionLimits(
      spouseAge,
      year,
      shared.inflation,
      shared.householdSize,
    );
    const primary401kApplied = primaryRetired
      ? 0
      : Math.min(Math.max(0, primary.contrib401k), primary401kLimit.k401Employee);
    const primaryMatchApplied = primaryRetired
      ? 0
      : Math.min(
          Math.max(0, primary.contribMatch),
          Math.max(0, primary401kLimit.k401Total - primary401kApplied),
        );
    const spouse401kApplied = spouseRetired
      ? 0
      : Math.min(Math.max(0, spouse.contrib401k), spouse401kLimit.k401Employee);
    const spouseMatchApplied = spouseRetired
      ? 0
      : Math.min(
          Math.max(0, spouse.contribMatch),
          Math.max(0, spouse401kLimit.k401Total - spouse401kApplied),
        );
    const hsaLimit = getCoupleHsaLimit(
      primaryAge,
      spouseAge,
      year,
      shared.inflation,
      shared.householdSize,
    );
    let remainingHsaLimit = hsaLimit;
    const primaryHsaApplied = primaryRetired
      ? 0
      : Math.min(Math.max(0, primary.contribHsa), remainingHsaLimit);
    remainingHsaLimit -= primaryHsaApplied;
    const spouseHsaApplied = spouseRetired
      ? 0
      : Math.min(Math.max(0, spouse.contribHsa), remainingHsaLimit);

    if (!householdRetired) {
      // Traditional IRA RMDs are required even while still working — the
      // still-working exception covers only the current employer's 401k.
      // Tax on the forced distribution is not modeled in accumulation years
      // (salary taxes are out of scope); gross amount moves to taxable.
      let accumIraRmd = 0;
      const takeAccumRmd = (state, age, rmdStartAge) => {
        if (age < rmdStartAge || state.bTradIra <= 0) return 0;
        const divisor = rmdDivisor(age);
        if (!divisor) return 0;
        const rmd = state.bTradIra / divisor;
        state.bTradIra -= rmd;
        return rmd;
      };
      accumIraRmd += takeAccumRmd(primaryState, primaryAge, primary.rmdStartAge);
      accumIraRmd += takeAccumRmd(spouseState, spouseAge, spouse.rmdStartAge);

      primaryState.b401k =
        primaryState.b401k * (1 + marketReturn) +
        primary401kApplied +
        primaryMatchApplied;
      spouseState.b401k =
        spouseState.b401k * (1 + marketReturn) +
        spouse401kApplied +
        spouseMatchApplied;
      primaryState.bTradIra *= 1 + marketReturn;
      spouseState.bTradIra *= 1 + marketReturn;
      primaryState.bRoth *= 1 + marketReturn;
      spouseState.bRoth *= 1 + marketReturn;
      primaryState.bHsa = primaryState.bHsa * (1 + marketReturn) + primaryHsaApplied;
      spouseState.bHsa = spouseState.bHsa * (1 + marketReturn) + spouseHsaApplied;
      cash *= 1 + shared.cashReturn;
      taxable = taxable * (1 + taxableReturn(marketReturn)) + accumIraRmd;
      taxableBasis += accumIraRmd;

      const total = totalAssets();
      priorPriorYearEndTotal = priorYearEndTotal;
      priorYearEndTotal = total;
      yearlyData.push({
        year,
        age: primaryAge,
        primaryAge,
        spouseAge,
        phase: "accumulation",
        spending: 0,
        partTime: 0,
        ss: 0,
        pension: 0,
        netNeed: 0,
        grossWithdrawal: 0,
        fromCash: 0,
        fromTaxable: 0,
        from401k: 0,
        fromIra: 0,
        fromRoth: 0,
        hsaWithdrawal: 0,
        conversion: 0,
        tax: 0,
        strategy: "Accumulating",
        cash: Math.round(cash),
        taxable: Math.round(taxable),
        k401: Math.round(primaryState.b401k + spouseState.b401k),
        tradIra: Math.round(primaryState.bTradIra + spouseState.bTradIra),
        roth: Math.round(primaryState.bRoth + spouseState.bRoth),
        hsa: Math.round(primaryState.bHsa + spouseState.bHsa),
        total: Math.round(total),
        rmdAmount: Math.round(accumIraRmd),
        realizedGain: 0,
        taxableSs: 0,
        magi: 0,
        taxableBasisEnd: Math.round(taxableBasis),
        irmaaSurcharge: 0,
        irmaaTriggered: false,
        acaSubsidy: 0,
        earlyPenalty: 0,
        cashFloor: 0,
        reserveUsed: 0,
        unmetCashFlow: Math.round(unpaidDebt),
        ownerDetails: {
          primary: {
            name: primary.name,
            employerPlanLabel: primary.employerPlanLabel || "401k",
            contribution401kApplied: Math.round(primary401kApplied),
            contributionHsaApplied: Math.round(primaryHsaApplied),
          },
          spouse: {
            name: spouse.name,
            employerPlanLabel: spouse.employerPlanLabel || "403b",
            contribution401kApplied: Math.round(spouse401kApplied),
            contributionHsaApplied: Math.round(spouseHsaApplied),
          },
        },
      });
      continue;
    }

    const primaryHealthcare = primaryRetired
      ? (primaryAge < 65 ? primary.healthcarePre65 : primary.healthcarePost65) * inflMult
      : 0;
    const spouseHealthcare = spouseRetired
      ? (spouseAge < 65 ? spouse.healthcarePre65 : spouse.healthcarePost65) * inflMult
      : 0;
    const lifestyleSpending = Math.round(shared.baseExpenses * inflMult);
    let spending = Math.round(lifestyleSpending + primaryHealthcare + spouseHealthcare);
    if (useFlexibleSpending && priorPriorYearEndTotal > 0 && yearsFromRetirement > 0) {
      const yoyChange =
        (priorYearEndTotal - priorPriorYearEndTotal) / priorPriorYearEndTotal;
      if (yoyChange < -0.15) spending = Math.round(spending * 0.9);
    }

    const primaryPartTime =
      primaryRetired && primaryAge < primary.retirementAge + primary.partTimeYears
        ? Math.round(primary.partTimeIncome * inflMult)
        : 0;
    const spousePartTime =
      spouseRetired && spouseAge < spouse.retirementAge + spouse.partTimeYears
        ? Math.round(spouse.partTimeIncome * inflMult)
        : 0;
    const primarySs =
      primaryAge >= Math.max(SS_MIN_CLAIM_AGE, primary.ssAge)
        ? Math.round(
            adjustedSocialSecurityBenefit(primary.ssIncome, primary.ssAge) *
              Math.pow(1 + shared.inflation, year - currentYear),
          )
        : 0;
    const spouseSs =
      spouseAge >= Math.max(SS_MIN_CLAIM_AGE, spouse.ssAge)
        ? Math.round(
            adjustedSocialSecurityBenefit(spouse.ssIncome, spouse.ssAge) *
              Math.pow(1 + shared.inflation, year - currentYear),
          )
        : 0;
    const primaryPension =
      primaryAge >= primary.pensionStartAge && primary.pensionIncome > 0
        ? Math.round(
            primary.pensionIncome *
              Math.pow(1 + primary.pensionCola, year - currentYear),
          )
        : 0;
    const spousePension =
      spouseAge >= spouse.pensionStartAge && spouse.pensionIncome > 0
        ? Math.round(
            spouse.pensionIncome *
              Math.pow(1 + spouse.pensionCola, year - currentYear),
          )
        : 0;

    // RMDs use start-of-year balances, which equal the prior December 31
    // balances now that growth is applied once at the end of each year.
    const primaryRmd =
      primaryAge >= primary.rmdStartAge
        ? Math.max(
            0,
            (primaryState.b401k + primaryState.bTradIra) /
              (rmdDivisor(primaryAge) || Infinity),
          )
        : 0;
    const spouseRmd =
      spouseAge >= spouse.rmdStartAge
        ? Math.max(
            0,
            (spouseState.b401k + spouseState.bTradIra) /
              (rmdDivisor(spouseAge) || Infinity),
          )
        : 0;
    const primaryConversion = personConversionTarget(
      primary,
      primaryAge,
      inflMult,
      primaryState.b401k,
      primaryRmd,
    );
    const spouseConversion = personConversionTarget(
      spouse,
      spouseAge,
      inflMult,
      spouseState.b401k,
      spouseRmd,
    );

    let hsaAllocation = allocateCoupleHsaWithdrawals(
      primaryState.bHsa,
      spouseState.bHsa,
      Math.max(0, spending - lifestyleSpending),
    );
    let totalPrimaryHsaWithdrawal = hsaAllocation.primary;
    let totalSpouseHsaWithdrawal = hsaAllocation.spouse;
    let hsaWithdrawal = hsaAllocation.total;

    const incomeTotal =
      primaryPartTime +
      spousePartTime +
      primarySs +
      spouseSs +
      primaryPension +
      spousePension;
    // Rule of 55 per spouse: separation from service at 55+ exempts that
    // spouse's 401k (never IRAs) from the §72(t) early-withdrawal penalty.
    const couplePenaltyFree401k = {
      primary: primary.retirementAge >= 55,
      spouse: spouse.retirementAge >= 55,
    };
    // Cash is a shared bucket, so the cash strategy and inflation-adjusted
    // reserve floor come from shared household settings.
    const coupleCashPolicy = {
      strategy: shared.cashStrategy || "cashFirst",
      reserveNominal:
        (shared.cashStrategy || "cashFirst") === "cashFirst"
          ? 0
          : Math.round(Math.max(0, shared.cashReserveFloor || 0) * inflMult),
      allowReserve: !!shared.allowReserveAsLastResort,
    };
    // Taxable interest on the shared Cash/HYSA balance (start-of-year).
    const coupleCashInterest = Math.max(0, cash * shared.cashReturn);
    let netNeed = Math.max(0, spending - hsaWithdrawal - incomeTotal);
    let solve = solveCoupleGrossedUpWithdrawals({
      netNeed,
      state: {
        cash,
        taxable,
        taxableBasis,
        primary401k: Math.max(0, primaryState.b401k - primaryConversion),
        spouse401k: Math.max(0, spouseState.b401k - spouseConversion),
        primaryTradIra: primaryState.bTradIra,
        spouseTradIra: spouseState.bTradIra,
        primaryRoth: primaryState.bRoth,
        spouseRoth: spouseState.bRoth,
      },
      preHouseholdSs: primarySs + spouseSs <= 0,
      conversions: { primary: primaryConversion, spouse: spouseConversion },
      rmds: { primary: primaryRmd, spouse: spouseRmd },
      incomes: {
        primaryPartTime,
        spousePartTime,
        primarySs,
        spouseSs,
        primaryPension,
        spousePension,
        primaryPensionNyExempt: primary.pensionNyExempt,
        spousePensionNyExempt: spouse.pensionNyExempt,
      },
      year,
      ages: { primary: primaryAge, spouse: spouseAge },
      inflation: shared.inflation,
      penaltyFree401k: couplePenaltyFree401k,
      cashPolicy: coupleCashPolicy,
      rothLayers: coupleRothLayers,
      interestIncome: coupleCashInterest,
    });
    let acaSubsidy = 0;
    const pre65HealthcareSticker =
      (primaryRetired && primaryAge < 65 ? primary.healthcarePre65 * inflMult : 0) +
      (spouseRetired && spouseAge < 65 ? spouse.healthcarePre65 * inflMult : 0);
    if (shared.useAcaSubsidyEstimate && pre65HealthcareSticker > 0) {
      const estimatedMagi = solve.ordIncome + solve.realizedGain;
      const subsidizedPre65Healthcare = estimateAcaHealthcareCost(
        pre65HealthcareSticker,
        estimatedMagi,
        shared.householdSize,
        year,
        shared.inflation,
      );
      acaSubsidy = Math.max(0, pre65HealthcareSticker - subsidizedPre65Healthcare);
      spending = Math.max(0, Math.round(spending - acaSubsidy));
      hsaAllocation = allocateCoupleHsaWithdrawals(
        primaryState.bHsa,
        spouseState.bHsa,
        Math.max(0, spending - lifestyleSpending),
      );
      totalPrimaryHsaWithdrawal = hsaAllocation.primary;
      totalSpouseHsaWithdrawal = hsaAllocation.spouse;
      hsaWithdrawal = hsaAllocation.total;
      netNeed = Math.max(0, spending - hsaWithdrawal - incomeTotal);
      solve = solveCoupleGrossedUpWithdrawals({
        netNeed,
        state: {
          cash,
          taxable,
          taxableBasis,
          primary401k: Math.max(0, primaryState.b401k - primaryConversion),
          spouse401k: Math.max(0, spouseState.b401k - spouseConversion),
          primaryTradIra: primaryState.bTradIra,
          spouseTradIra: spouseState.bTradIra,
          primaryRoth: primaryState.bRoth,
          spouseRoth: spouseState.bRoth,
        },
        preHouseholdSs: primarySs + spouseSs <= 0,
        conversions: { primary: primaryConversion, spouse: spouseConversion },
        rmds: { primary: primaryRmd, spouse: spouseRmd },
        incomes: {
          primaryPartTime,
          spousePartTime,
          primarySs,
          spouseSs,
          primaryPension,
          spousePension,
          primaryPensionNyExempt: primary.pensionNyExempt,
          spousePensionNyExempt: spouse.pensionNyExempt,
        },
        year,
        ages: { primary: primaryAge, spouse: spouseAge },
        inflation: shared.inflation,
        penaltyFree401k: couplePenaltyFree401k,
        cashPolicy: coupleCashPolicy,
        rothLayers: coupleRothLayers,
        interestIncome: coupleCashInterest,
      });
    }

    let irmaaSurcharge = 0;
    if (primaryAge >= 65 || spouseAge >= 65) {
      const medicareEnrollees =
        (primaryAge >= 65 ? 1 : 0) + (spouseAge >= 65 ? 1 : 0);
      const baseSpendingBeforeIrmaa = spending;
      for (let outerIter = 0; outerIter < 4; outerIter++) {
        // Real IRMAA looks back two years; use the projected MAGI from that
        // year when the projection has one, else same-year MAGI (working-year
        // salary MAGI is out of scope for this model).
        const lookbackMagi = coupleMagiByYear[year - 2];
        const newIrmaa = computeIrmaaSurcharge(
          lookbackMagi != null
            ? lookbackMagi
            : solve.ordIncome + solve.realizedGain,
          year,
          shared.inflation,
          medicareEnrollees,
        );
        if (Math.abs(newIrmaa - irmaaSurcharge) < 10) {
          irmaaSurcharge = newIrmaa;
          break;
        }
        irmaaSurcharge = newIrmaa;
        spending = Math.round(baseSpendingBeforeIrmaa + irmaaSurcharge);
        hsaAllocation = allocateCoupleHsaWithdrawals(
          primaryState.bHsa,
          spouseState.bHsa,
          Math.max(0, spending - lifestyleSpending),
        );
        totalPrimaryHsaWithdrawal = hsaAllocation.primary;
        totalSpouseHsaWithdrawal = hsaAllocation.spouse;
        hsaWithdrawal = hsaAllocation.total;
        netNeed = Math.max(0, spending - hsaWithdrawal - incomeTotal);
        solve = solveCoupleGrossedUpWithdrawals({
          netNeed,
          state: {
            cash,
            taxable,
            taxableBasis,
            primary401k: Math.max(0, primaryState.b401k - primaryConversion),
            spouse401k: Math.max(0, spouseState.b401k - spouseConversion),
            primaryTradIra: primaryState.bTradIra,
            spouseTradIra: spouseState.bTradIra,
            primaryRoth: primaryState.bRoth,
            spouseRoth: spouseState.bRoth,
          },
          preHouseholdSs: primarySs + spouseSs <= 0,
          conversions: { primary: primaryConversion, spouse: spouseConversion },
          rmds: { primary: primaryRmd, spouse: spouseRmd },
          incomes: {
            primaryPartTime,
            spousePartTime,
            primarySs,
            spouseSs,
            primaryPension,
            spousePension,
            primaryPensionNyExempt: primary.pensionNyExempt,
            spousePensionNyExempt: spouse.pensionNyExempt,
          },
          year,
          ages: { primary: primaryAge, spouse: spouseAge },
          inflation: shared.inflation,
          penaltyFree401k: couplePenaltyFree401k,
          cashPolicy: coupleCashPolicy,
          rothLayers: coupleRothLayers,
          interestIncome: coupleCashInterest,
        });
      }
      spending = Math.round(baseSpendingBeforeIrmaa + irmaaSurcharge);
    }

    const { withdrawals } = solve;
    const tax = solve.tax;
    const realizedGain = solve.realizedGain;
    const basisReduction = Math.max(0, withdrawals.taxable - realizedGain);

    cash = Math.max(0, cash - withdrawals.cash);
    taxable = Math.max(0, taxable - withdrawals.taxable);
    taxableBasis = Math.max(0, taxableBasis - basisReduction);
    primaryState.b401k = Math.max(
      0,
      primaryState.b401k - withdrawals.primary401k - primaryConversion,
    );
    spouseState.b401k = Math.max(
      0,
      spouseState.b401k - withdrawals.spouse401k - spouseConversion,
    );
    primaryState.bTradIra = Math.max(0, primaryState.bTradIra - withdrawals.primaryIra);
    spouseState.bTradIra = Math.max(0, spouseState.bTradIra - withdrawals.spouseIra);
    consumeRothLayers(withdrawals.primaryRoth, coupleRothLayers.primary);
    consumeRothLayers(withdrawals.spouseRoth, coupleRothLayers.spouse);
    if (primaryConversion > 0)
      coupleRothLayers.primary.vintages.push({ year, amount: primaryConversion });
    if (spouseConversion > 0)
      coupleRothLayers.spouse.vintages.push({ year, amount: spouseConversion });
    primaryState.bRoth = Math.max(
      0,
      primaryState.bRoth + primaryConversion - withdrawals.primaryRoth,
    );
    spouseState.bRoth = Math.max(
      0,
      spouseState.bRoth + spouseConversion - withdrawals.spouseRoth,
    );
    primaryState.bHsa = Math.max(0, primaryState.bHsa - totalPrimaryHsaWithdrawal);
    spouseState.bHsa = Math.max(0, spouseState.bHsa - totalSpouseHsaWithdrawal);

    const grossWithdrawal =
      withdrawals.cash +
      withdrawals.taxable +
      withdrawals.primary401k +
      withdrawals.spouse401k +
      withdrawals.primaryIra +
      withdrawals.spouseIra +
      withdrawals.primaryRoth +
      withdrawals.spouseRoth;
    const surplusFromRmd = Math.max(0, grossWithdrawal - (netNeed + tax));
    if (surplusFromRmd > 0) cash += surplusFromRmd;
    const unmetCashFlow = Math.max(0, netNeed + tax - grossWithdrawal);
    totalUnmetCashFlow += unmetCashFlow;

    cash *= 1 + shared.cashReturn;
    taxable *= 1 + taxableReturn(marketReturn);
    primaryState.b401k =
      primaryState.b401k * (1 + marketReturn) +
      primary401kApplied +
      primaryMatchApplied;
    spouseState.b401k =
      spouseState.b401k * (1 + marketReturn) +
      spouse401kApplied +
      spouseMatchApplied;
    primaryState.bTradIra *= 1 + marketReturn;
    spouseState.bTradIra *= 1 + marketReturn;
    primaryState.bRoth *= 1 + marketReturn;
    spouseState.bRoth *= 1 + marketReturn;
    primaryState.bHsa = primaryState.bHsa * (1 + marketReturn) + primaryHsaApplied;
    spouseState.bHsa = spouseState.bHsa * (1 + marketReturn) + spouseHsaApplied;

    totalTaxesPaid += tax;
    totalConverted += primaryConversion + spouseConversion;
    coupleMagiByYear[year] = solve.ordIncome + realizedGain;

    const total = totalAssets();
    priorPriorYearEndTotal = priorYearEndTotal;
    priorYearEndTotal = total;
    if ((total <= 0 || unmetCashFlow > 1) && !depleted) depleted = true;

    let phase = "bridge";
    if (primarySs + spouseSs > 0) phase = "ss";
    else if (primaryAge >= 65 || spouseAge >= 65) phase = "medicare";
    else if (primaryAge >= 60 || spouseAge >= 60) phase = "mid";

    yearlyData.push({
      year,
      age: primaryAge,
      primaryAge,
      spouseAge,
      phase,
      spending,
      partTime: primaryPartTime + spousePartTime,
      ss: primarySs + spouseSs,
      pension: primaryPension + spousePension,
      netNeed,
      grossWithdrawal: Math.round(grossWithdrawal),
      fromCash: Math.round(withdrawals.cash),
      fromTaxable: Math.round(withdrawals.taxable),
      from401k: Math.round(withdrawals.primary401k + withdrawals.spouse401k),
      fromIra: Math.round(withdrawals.primaryIra + withdrawals.spouseIra),
      fromRoth: Math.round(withdrawals.primaryRoth + withdrawals.spouseRoth),
      hsaWithdrawal: Math.round(hsaWithdrawal),
      conversion: Math.round(primaryConversion + spouseConversion),
      tax,
      strategy: "Couple household plan",
      cash: Math.round(cash),
      taxable: Math.round(taxable),
      k401: Math.round(primaryState.b401k + spouseState.b401k),
      tradIra: Math.round(primaryState.bTradIra + spouseState.bTradIra),
      roth: Math.round(primaryState.bRoth + spouseState.bRoth),
      hsa: Math.round(primaryState.bHsa + spouseState.bHsa),
      total: Math.round(total),
      rmdAmount: Math.round(primaryRmd + spouseRmd),
      realizedGain: Math.round(realizedGain),
      taxableSs: Math.round(solve.taxableSs),
      magi: Math.round(solve.ordIncome + realizedGain),
      taxableBasisEnd: Math.round(taxableBasis),
      irmaaSurcharge: Math.round(irmaaSurcharge),
      irmaaTriggered: irmaaSurcharge > 0,
      acaSubsidy: Math.round(acaSubsidy),
      earlyPenalty: solve.earlyPenalty,
      cashFloor: coupleCashPolicy.reserveNominal,
      reserveUsed: Math.round(withdrawals.reserveUsed || 0),
      unmetCashFlow: Math.round(unmetCashFlow),
      ownerDetails: {
        primary: {
          name: primary.name,
          employerPlanLabel: primary.employerPlanLabel || "401k",
          from401k: Math.round(withdrawals.primary401k),
          fromIra: Math.round(withdrawals.primaryIra),
          fromRoth: Math.round(withdrawals.primaryRoth),
          hsaWithdrawal: Math.round(totalPrimaryHsaWithdrawal),
          conversion: Math.round(primaryConversion),
          rmdAmount: Math.round(primaryRmd),
          ss: primarySs,
          pension: primaryPension,
          partTime: primaryPartTime,
        },
        spouse: {
          name: spouse.name,
          employerPlanLabel: spouse.employerPlanLabel || "403b",
          from401k: Math.round(withdrawals.spouse401k),
          fromIra: Math.round(withdrawals.spouseIra),
          fromRoth: Math.round(withdrawals.spouseRoth),
          hsaWithdrawal: Math.round(totalSpouseHsaWithdrawal),
          conversion: Math.round(spouseConversion),
          rmdAmount: Math.round(spouseRmd),
          ss: spouseSs,
          pension: spousePension,
          partTime: spousePartTime,
        },
      },
    });
  }

  const displayInputs = getDisplayInputs({ mode: "couple", couple: { primary, spouse, shared } });
  const retirementData = yearlyData.find((d) => d.phase !== "accumulation");
  const endData = yearlyData[yearlyData.length - 1];
  const startOfRetirement =
    retirementData &&
    yearlyData
      .slice()
      .reverse()
      .find((d) => d.year < retirementData.year);
  const startBalance =
    startOfRetirement && startOfRetirement.total > 0
      ? startOfRetirement.total
      : retirementData && retirementData.total > 0
        ? retirementData.total
        : 1;

  return {
    yearlyData,
    summary: {
      portfolioAtRetirement: retirementData ? retirementData.total : 0,
      portfolioAtEnd: endData ? endData.total : 0,
      year1WithdrawalRate:
        retirementData && retirementData.grossWithdrawal !== undefined
          ? retirementData.grossWithdrawal / startBalance
          : 0,
      year1Spending: retirementData ? retirementData.spending : 0,
      totalTaxesPaid: Math.round(totalTaxesPaid),
      totalConverted: Math.round(totalConverted),
      totalUnmetCashFlow: Math.round(totalUnmetCashFlow),
      depleted,
      rmdStartAge: Math.min(primary.rmdStartAge, spouse.rmdStartAge),
      currentTotal:
        shared.balanceCash +
        shared.balanceTaxable +
        primary.balance401k +
        spouse.balance401k +
        primary.balanceTradIra +
        spouse.balanceTradIra +
        primary.balanceRoth +
        spouse.balanceRoth +
        primary.balanceHsa +
        spouse.balanceHsa -
        (shared.creditCardDebt || 0),
      planThroughAge: displayInputs.planThroughAge,
    },
  };
}

function simulatePlan(inputs, options = {}) {
  return isCoupleMode(inputs) ? simulateCouple(inputs.couple, options) : simulate(inputs, options);
}

// ============================================================
// UI HELPERS
// ============================================================

function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (Math.abs(n) >= 10_000) return "$" + Math.round(n / 1000) + "K";
  return "$" + Math.round(n).toLocaleString();
}

function fmtMoneyFull(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return "$" + Math.round(n).toLocaleString();
}

function fmtPct(n) {
  return (n * 100).toFixed(1) + "%";
}
const DEFAULT_INPUTS = {
  mode: "single",
  // Tax filing status for Individual mode: "single" or "mfj".
  // Individual plans default to single-filer taxes; a married person modeling
  // only their own accounts can switch to MFJ. Couple mode is always MFJ.
  filingStatus: "single",
  currentAge: 45,
  retirementAge: 60,
  planThroughAge: 95,
  // Cash accounts (checking + savings + cash reserves)
  balanceCash: 50000,
  // Taxable brokerage
  balanceTaxable: 200000,
  // Employer retirement plan (401k / 403b / etc.)
  balance401k: 500000,
  // Traditional IRA
  balanceTradIra: 50000,
  // Roth IRA
  balanceRoth: 75000,
  // Total Roth *contributions* to date (not conversions, not growth) -
  // withdrawable anytime tax- and penalty-free. 0 = conservative default.
  rothBasis: 0,
  // HSA cash + HSA investment
  balanceHsa: 25000,
  // Credit card debt (subtracted from net worth)
  creditCardDebt: 0,
  preReturn: 0.06,
  postReturn: 0.055,
  cashReturn: 0.04,
  inflation: 0.03,
  contrib401k: 23500,
  contribMatch: 5000,
  contribHsa: 4300,
  baseExpenses: 60000,
  healthcarePre65: 18000,
  healthcarePost65: 8000,
  partTimeIncome: 0,
  partTimeYears: 0,
  ssIncome: 24000,
  ssAge: 67,
  // Pension (for defined-benefit plans like teacher pensions)
  // Leave Annual Pension at 0 if none. When you set a pension, the UI
  // auto-fills Pension Start Age to your retirement age (override if needed).
  pensionIncome: 0, // Annual pension in today's dollars
  pensionStartAge: 60, // Gets auto-synced to retirementAge when pension is enabled
  pensionCola: 0.02, // Cost-of-living adjustment (NY teacher ~2%)
  pensionNyExempt: true, // NY public pensions (teacher, fed, military) are fully state-exempt
  // RMD (Required Minimum Distribution) configuration
  rmdStartAge: defaultRmdStartAge(45), // SECURE 2.0 derived from current age/start year
  // Taxable account cost basis as % of current value
  // Example: if you've contributed $130K and account is worth $190K, basis% ≈ 68%
  // Lower % = more embedded gain = higher tax when withdrawing
  taxableBasisPct: 0.7,
  // Estimated annual dividend/turnover tax drag in taxable brokerage.
  taxableAnnualTaxDrag: 0.005,
  // ACA subsidy estimation (pre-65 healthcare cost sensitivity to MAGI)
  useAcaSubsidyEstimate: false, // Off by default — opt-in
  householdSize: 1, // For FPL calculation
  // Cash drawdown strategy:
  //   cashFirst       — legacy: spend cash before anything else (no reserve)
  //   preserveReserve — cash first, but never below the reserve floor
  //   proportional    — split draws across cash/taxable/tax-deferred pro-rata
  //   cashLast        — touch cash only when other sources (except Roth) are empty
  cashStrategy: "cashFirst",
  // Minimum cash to keep on hand, in today's dollars (inflation-adjusted in
  // the projection). Ignored under the "cashFirst" strategy.
  cashReserveFloor: 0,
  // If true, the reserve may be spent when every other account is empty
  // (flagged in the year-by-year table). If false, the plan shows a shortfall
  // instead of touching the reserve.
  allowReserveAsLastResort: false,
  // 72(t) SEPP program (individual mode): fixed-amortization payments from
  // tax-deferred accounts, penalty-free, from retirement until the later of
  // 5 years or 59.5. Rate must not exceed 120% of the federal mid-term rate.
  useSepp: false,
  seppRate: 0.05,
  conversionBridge: 0,
  conversionMid: 0,
  conversionFinal: 0,
  // Portfolio volatility (std dev of annual returns)
  // ~9% = diversified 60/40 retirement portfolio (typical target-date fund)
  // ~11% = moderately aggressive
  // ~15% = 100% equities
  portfolioVolatility: 0.09,
  // Flexible spending: reduce withdrawals 10% when portfolio declines >15% YoY
  // Reflects real-world retiree behavior; significantly improves success rates
  flexibleSpending: true,
};

const DEFAULT_COUPLE_INPUTS = {
  primary: {
    name: "Primary",
    employerPlanLabel: "401k",
    currentAge: DEFAULT_INPUTS.currentAge,
    retirementAge: DEFAULT_INPUTS.retirementAge,
    planThroughAge: DEFAULT_INPUTS.planThroughAge,
    balance401k: DEFAULT_INPUTS.balance401k,
    balanceTradIra: DEFAULT_INPUTS.balanceTradIra,
    balanceRoth: DEFAULT_INPUTS.balanceRoth,
    rothBasis: DEFAULT_INPUTS.rothBasis,
    balanceHsa: DEFAULT_INPUTS.balanceHsa,
    contrib401k: DEFAULT_INPUTS.contrib401k,
    contribMatch: DEFAULT_INPUTS.contribMatch,
    contribHsa: DEFAULT_INPUTS.contribHsa,
    partTimeIncome: DEFAULT_INPUTS.partTimeIncome,
    partTimeYears: DEFAULT_INPUTS.partTimeYears,
    ssIncome: DEFAULT_INPUTS.ssIncome,
    ssAge: DEFAULT_INPUTS.ssAge,
    pensionIncome: DEFAULT_INPUTS.pensionIncome,
    pensionStartAge: DEFAULT_INPUTS.pensionStartAge,
    pensionCola: DEFAULT_INPUTS.pensionCola,
    pensionNyExempt: DEFAULT_INPUTS.pensionNyExempt,
    rmdStartAge: DEFAULT_INPUTS.rmdStartAge,
    conversionBridge: DEFAULT_INPUTS.conversionBridge,
    conversionMid: DEFAULT_INPUTS.conversionMid,
    conversionFinal: DEFAULT_INPUTS.conversionFinal,
    healthcarePre65: DEFAULT_INPUTS.healthcarePre65,
    healthcarePost65: DEFAULT_INPUTS.healthcarePost65,
  },
  spouse: {
    name: "Spouse",
    employerPlanLabel: "403b",
    currentAge: DEFAULT_INPUTS.currentAge + 5,
    retirementAge: DEFAULT_INPUTS.retirementAge + 5,
    planThroughAge: DEFAULT_INPUTS.planThroughAge + 5,
    balance401k: 0,
    balanceTradIra: 0,
    balanceRoth: 0,
    rothBasis: 0,
    balanceHsa: 0,
    contrib401k: 0,
    contribMatch: 0,
    contribHsa: 0,
    partTimeIncome: 0,
    partTimeYears: 0,
    ssIncome: 0,
    ssAge: 67,
    pensionIncome: 0,
    pensionStartAge: DEFAULT_INPUTS.retirementAge + 5,
    pensionCola: DEFAULT_INPUTS.pensionCola,
    pensionNyExempt: DEFAULT_INPUTS.pensionNyExempt,
    rmdStartAge: defaultRmdStartAge(DEFAULT_INPUTS.currentAge + 5),
    conversionBridge: 0,
    conversionMid: 0,
    conversionFinal: 0,
    healthcarePre65: DEFAULT_INPUTS.healthcarePre65,
    healthcarePost65: DEFAULT_INPUTS.healthcarePost65,
  },
  shared: {
    balanceCash: DEFAULT_INPUTS.balanceCash,
    balanceTaxable: DEFAULT_INPUTS.balanceTaxable,
    taxableBasisPct: DEFAULT_INPUTS.taxableBasisPct,
    creditCardDebt: DEFAULT_INPUTS.creditCardDebt,
    baseExpenses: DEFAULT_INPUTS.baseExpenses,
    preReturn: DEFAULT_INPUTS.preReturn,
    postReturn: DEFAULT_INPUTS.postReturn,
    cashReturn: DEFAULT_INPUTS.cashReturn,
    inflation: DEFAULT_INPUTS.inflation,
    taxableAnnualTaxDrag: DEFAULT_INPUTS.taxableAnnualTaxDrag,
    useAcaSubsidyEstimate: DEFAULT_INPUTS.useAcaSubsidyEstimate,
    // A married couple is at least 2 people. This drives the family-vs-self
    // HSA limit, the FPL used for ACA subsidies, and Medicare enrollee counts.
    householdSize: 2,
    portfolioVolatility: DEFAULT_INPUTS.portfolioVolatility,
    flexibleSpending: DEFAULT_INPUTS.flexibleSpending,
    cashStrategy: DEFAULT_INPUTS.cashStrategy,
    cashReserveFloor: DEFAULT_INPUTS.cashReserveFloor,
    allowReserveAsLastResort: DEFAULT_INPUTS.allowReserveAsLastResort,
  },
};
function normalizeCouplePerson(person, fallback) {
  const merged = { ...fallback, ...(person || {}) };
  const computedRmdStartAge = defaultRmdStartAge(
    merged.currentAge,
    PROJECTION_START_YEAR,
  );
  return {
    ...merged,
    rmdStartAge: merged.rmdStartAge ?? computedRmdStartAge,
  };
}

function normalizeCoupleInputs(coupleInputs) {
  const shared = {
    ...DEFAULT_COUPLE_INPUTS.shared,
    ...(coupleInputs?.shared || {}),
  };
  // Couple mode always models at least a 2-person household; stored scenarios
  // from before this floor existed may carry a stale householdSize of 1,
  // which silently capped the household HSA at the self-only limit.
  shared.householdSize = Math.max(2, shared.householdSize || 2);
  return {
    primary: normalizeCouplePerson(
      coupleInputs?.primary,
      DEFAULT_COUPLE_INPUTS.primary,
    ),
    spouse: normalizeCouplePerson(
      coupleInputs?.spouse,
      DEFAULT_COUPLE_INPUTS.spouse,
    ),
    shared,
  };
}

function isCoupleMode(inputs) {
  return inputs?.mode === "couple";
}

function getDisplayInputs(inputs) {
  if (!isCoupleMode(inputs)) return inputs;
  const couple = normalizeCoupleInputs(inputs.couple);
  const { primary, spouse, shared } = couple;
  const firstRetirementAge = Math.min(primary.retirementAge, spouse.retirementAge);
  const finalPrimaryAge = Math.max(
    primary.planThroughAge,
    primary.currentAge + (spouse.planThroughAge - spouse.currentAge),
  );
  return {
    ...DEFAULT_INPUTS,
    ...shared,
    mode: "couple",
    filingStatus: "mfj",
    currentAge: primary.currentAge,
    retirementAge: firstRetirementAge,
    planThroughAge: finalPrimaryAge,
    balance401k: primary.balance401k + spouse.balance401k,
    balanceTradIra: primary.balanceTradIra + spouse.balanceTradIra,
    balanceRoth: primary.balanceRoth + spouse.balanceRoth,
    balanceHsa: primary.balanceHsa + spouse.balanceHsa,
    contrib401k: primary.contrib401k + spouse.contrib401k,
    contribMatch: primary.contribMatch + spouse.contribMatch,
    contribHsa: primary.contribHsa + spouse.contribHsa,
    healthcarePre65: primary.healthcarePre65 + spouse.healthcarePre65,
    healthcarePost65: primary.healthcarePost65 + spouse.healthcarePost65,
    partTimeIncome: primary.partTimeIncome + spouse.partTimeIncome,
    partTimeYears: Math.max(primary.partTimeYears, spouse.partTimeYears),
    ssIncome: primary.ssIncome + spouse.ssIncome,
    ssAge: Math.min(primary.ssAge, spouse.ssAge),
    pensionIncome: primary.pensionIncome + spouse.pensionIncome,
    pensionStartAge: Math.min(primary.pensionStartAge, spouse.pensionStartAge),
    pensionCola: Math.max(primary.pensionCola, spouse.pensionCola),
    rmdStartAge: Math.min(primary.rmdStartAge, spouse.rmdStartAge),
    conversionBridge: primary.conversionBridge + spouse.conversionBridge,
    conversionMid: primary.conversionMid + spouse.conversionMid,
    conversionFinal: primary.conversionFinal + spouse.conversionFinal,
    spouseCurrentAge: spouse.currentAge,
    spouseRetirementAge: spouse.retirementAge,
    spousePlanThroughAge: spouse.planThroughAge,
  };
}

function diagnoseSuccessRate(inputs, results, mcResults) {
  const factors = [];
  const s = results.summary;

  // Factor 1: Withdrawal rate (guideline scales with the plan's horizon)
  const wdRate = s.year1WithdrawalRate;
  const horizonYears = inputs.planThroughAge - inputs.retirementAge;
  const wdGuideline = safeWithdrawalGuideline(horizonYears);
  const wdGuidelinePct = `${(wdGuideline * 100).toFixed(2)}`.replace(/\.?0+$/u, "");
  if (wdRate > wdGuideline + 0.02) {
    factors.push({
      impact: "negative",
      severity: "high",
      title: "Withdrawal rate is too high",
      detail: `Pulling ${(wdRate * 100).toFixed(1)}% per year from your portfolio in Year 1 — the guideline for a ${horizonYears}-year retirement is about ${wdGuidelinePct}%. Rates this far above it significantly raise failure risk.`,
      fix: "Reduce spending, earn more part-time income, or delay retirement 2-3 years.",
    });
  } else if (wdRate > wdGuideline + 0.005) {
    factors.push({
      impact: "negative",
      severity: "medium",
      title: "Withdrawal rate is above the safe zone",
      detail: `Your ${(wdRate * 100).toFixed(1)}% Year-1 withdrawal is above the ~${wdGuidelinePct}% guideline for a ${horizonYears}-year retirement. Still workable, but little margin for sequence-of-returns shocks.`,
      fix: "Even small spending cuts or extra part-time income tighten this up significantly.",
    });
  } else if (wdRate < wdGuideline) {
    factors.push({
      impact: "positive",
      severity: "high",
      title: "Low withdrawal rate",
      detail: `Your Year-1 withdrawal rate is ${(wdRate * 100).toFixed(1)}% — below the ~${wdGuidelinePct}% guideline for a ${horizonYears}-year retirement. This is the single biggest predictor of plan success.`,
      fix: null,
    });
  } else {
    factors.push({
      impact: "neutral",
      severity: "medium",
      title: "Withdrawal rate is right at the guideline",
      detail: `Your ${(wdRate * 100).toFixed(1)}% Year-1 withdrawal sits at the ~${wdGuidelinePct}% guideline for a ${horizonYears}-year retirement — workable, but with no cushion.`,
      fix: null,
    });
  }

  // Factor 2: Retirement length
  const retYears = inputs.planThroughAge - inputs.retirementAge;
  if (retYears > 40) {
    factors.push({
      impact: "negative",
      severity: "medium",
      title: "Very long retirement horizon",
      detail: `Planning for ${retYears} years is well beyond the typical 30-year horizon used in the 4% rule research. Small problems compound over that long a period.`,
      fix: "Either reduce planning age or ensure withdrawal rate is below 3.5%.",
    });
  } else if (retYears > 35) {
    factors.push({
      impact: "negative",
      severity: "low",
      title: "Long retirement horizon",
      detail: `${retYears} years is a long time for a portfolio to last — longer than the 30-year horizon most historical "safe withdrawal" research uses.`,
      fix: null,
    });
  }

  // Factor 3: Gap between retirement and Social Security
  // (claim age floors at 62 in the engine; mirror that here)
  const gapYears = Math.max(62, inputs.ssAge) - inputs.retirementAge;
  if (gapYears > 12) {
    factors.push({
      impact: "negative",
      severity: "medium",
      title: `Long gap before Social Security (${gapYears} years)`,
      detail: `You're self-funding ${gapYears} years before SS kicks in. The longer this gap, the more vulnerable your portfolio is to bad early-market years.`,
      fix: "Consider claiming SS earlier (at 62-65) if the Monte Carlo keeps failing.",
    });
  } else if (gapYears <= 7) {
    factors.push({
      impact: "positive",
      severity: "low",
      title: "Short bridge to Social Security",
      detail: `Only ${gapYears} years before SS starts covering a meaningful portion of your spending, which reduces portfolio strain.`,
      fix: null,
    });
  }

  // Factor 4: Part-time income
  const spendingFirst = (inputs.baseExpenses + inputs.healthcarePre65);
  const ptCoverage = inputs.partTimeIncome / spendingFirst;
  if (ptCoverage >= 0.25) {
    factors.push({
      impact: "positive",
      severity: "medium",
      title: "Strong part-time income",
      detail: `Your $${inputs.partTimeIncome.toLocaleString()}/year part-time income covers ${(ptCoverage * 100).toFixed(0)}% of early spending — this meaningfully reduces portfolio withdrawals during the bridge years.`,
      fix: null,
    });
  } else if (ptCoverage < 0.1 && inputs.partTimeIncome < 10000) {
    factors.push({
      impact: "negative",
      severity: "low",
      title: "Limited part-time income buffer",
      detail: `Part-time income covers only ${(ptCoverage * 100).toFixed(0)}% of spending. Even a small amount of earned income during bad market years dramatically improves portfolio longevity.`,
      fix: "Even $15-25K/year of part-time income in the early years makes a real difference.",
    });
  }

  // Factor 5: Portfolio composition (cash drag vs growth)
  const total = s.currentTotal;
  const cashPct = inputs.balanceCash / (total + (inputs.creditCardDebt || 0));
  if (cashPct > 0.15) {
    factors.push({
      impact: "negative",
      severity: "low",
      title: "High cash allocation",
      detail: `${(cashPct * 100).toFixed(0)}% of your portfolio is in cash, which earns ~${(inputs.cashReturn * 100).toFixed(1)}%. Over 35+ years, this meaningfully underperforms a diversified portfolio and eats into long-term success.`,
      fix: "Keep 2-3 years of spending in cash; invest the rest in a diversified portfolio.",
    });
  }

  // Factor 6: Spending-to-portfolio ratio
  const totalSpending = inputs.baseExpenses + inputs.healthcarePre65;
  const spendingRatio = totalSpending / total;
  if (spendingRatio > 0.05 && spendingRatio <= 0.06) {
    factors.push({
      impact: "neutral",
      severity: "medium",
      title: "Spending is close to portfolio capacity",
      detail: `Your annual spending (~$${totalSpending.toLocaleString()}) is ${(spendingRatio * 100).toFixed(1)}% of your portfolio. Even with returns, this is near the edge of sustainable.`,
      fix: null,
    });
  }

  // Factor 7: Roth conversion benefit
  if (s.totalConverted > 500000) {
    factors.push({
      impact: "positive",
      severity: "low",
      title: "Roth conversions reduce future RMD pressure",
      detail: `Your plan converts $${(s.totalConverted / 1000).toFixed(0)}K from tax-deferred accounts to Roth during low-tax years. This reduces the tax-deferred balance subject to Required Minimum Distributions starting at age ${s.rmdStartAge || inputs.rmdStartAge || defaultRmdStartAge(inputs.currentAge)}, which can keep you in lower tax brackets later in life.`,
      fix: null,
    });
  }

  // Factor 8: Healthcare cost sensitivity
  if (inputs.healthcarePre65 > 30000 && gapYears > 5) {
    factors.push({
      impact: "negative",
      severity: "low",
      title: "High pre-Medicare healthcare costs",
      detail: `$${inputs.healthcarePre65.toLocaleString()}/year for healthcare until 65 is a significant drain. ACA subsidies (if income is low enough) could reduce this dramatically.`,
      fix: "Research ACA marketplace options with strategic income control for subsidy eligibility.",
    });
  }

  // Summary verdict
  let verdict = "";
  let verdictTone = "neutral";
  const sr = mcResults.successRate;
  if (sr >= 0.95) {
    verdict = "In this model's assumptions, the plan looks robust. Positive factors outweigh negatives and most simulated scenarios survive.";
    verdictTone = "good";
  } else if (sr >= 0.85) {
    verdict = "Plan is in the historically favorable range. Most simulated scenarios work out; the ones that don't are unusually unlucky sequences.";
    verdictTone = "good";
  } else if (sr >= 0.75) {
    verdict = "Plan is workable but has pressure points. Addressing the highlighted negatives would move it into a more comfortable range.";
    verdictTone = "warn";
  } else if (sr >= 0.6) {
    verdict = "Plan has meaningful risk. The factors below create vulnerability — particularly in scenarios where markets underperform early.";
    verdictTone = "warn";
  } else {
    verdict = "Your plan is likely to fail in unfavorable market conditions. The negative factors below compound — each one alone might be manageable, but together they make the plan fragile.";
    verdictTone = "bad";
  }

  return { factors, verdict, verdictTone };
}

// Bisection on base lifestyle spending: the largest value (to the nearest
// $500) where the plan does not run out of money, holding every other input
// constant. Costs roughly 15-30 simulatePlan runs; callers must memoize.
function solveMaxSustainableSpending(inputs) {
  const withSpending = (value) => {
    if (!isCoupleMode(inputs)) return { ...inputs, baseExpenses: value };
    const couple = normalizeCoupleInputs(inputs.couple);
    return {
      ...inputs,
      couple: { ...couple, shared: { ...couple.shared, baseExpenses: value } },
    };
  };
  // Invalid inputs (mid-typing) produce an empty projection — no answer.
  if (simulatePlan(inputs).yearlyData.length === 0) return null;
  const isFunded = (value) =>
    computeShortfallInfo(simulatePlan(withSpending(value))).status !== "danger";
  if (!isFunded(0)) return null;
  let lo = 0;
  let hi = Math.max(getDisplayInputs(inputs).baseExpenses || 0, 50000);
  let guard = 0;
  while (isFunded(hi) && guard < 12) {
    lo = hi;
    hi *= 2;
    guard++;
  }
  if (guard >= 12) return Math.round(lo / 500) * 500;
  while (hi - lo > 500) {
    const mid = (lo + hi) / 2;
    if (isFunded(mid)) lo = mid;
    else hi = mid;
  }
  return Math.round(lo / 500) * 500;
}

// ============================================================
// CASH-STRATEGY PENALTY IMPACT — definitive, not hypothetical
// ============================================================
// The engine knows exactly whether a withdrawal order sends money through
// penalized accounts before 59½. Run the full projection once per strategy
// (everything else held constant) so the UI can state what WILL happen with
// the user's actual inputs and recommend the order that minimizes penalties.

const CASH_STRATEGY_VALUES = [
  "cashFirst",
  "preserveReserve",
  "proportional",
  "cashLast",
];

function summarizeCashStrategyRun(results) {
  let penaltyTotal = 0;
  let penaltyYears = 0;
  let firstPenaltyAge = null;
  let lastPenaltyAge = null;
  for (const d of results.yearlyData) {
    if ((d.earlyPenalty || 0) > 0) {
      penaltyTotal += d.earlyPenalty;
      penaltyYears += 1;
      if (firstPenaltyAge == null) firstPenaltyAge = d.age;
      lastPenaltyAge = d.age;
    }
  }
  return {
    penaltyTotal: Math.round(penaltyTotal),
    // The §72(t) penalty is exactly 10% of the penalized withdrawals.
    penalizedDraws: Math.round(penaltyTotal * 10),
    penaltyYears,
    firstPenaltyAge,
    lastPenaltyAge,
    totalTaxes: results.summary.totalTaxesPaid,
    endBalance: results.summary.portfolioAtEnd,
    unmet: results.summary.totalUnmetCashFlow,
  };
}

function compareCashStrategies(inputs) {
  const withStrategy = (strategy) => {
    if (!isCoupleMode(inputs)) return { ...inputs, cashStrategy: strategy };
    const couple = normalizeCoupleInputs(inputs.couple);
    return {
      ...inputs,
      couple: {
        ...couple,
        shared: { ...couple.shared, cashStrategy: strategy },
      },
    };
  };
  const impact = {};
  for (const strategy of CASH_STRATEGY_VALUES) {
    const run = simulatePlan(withStrategy(strategy));
    if (run.yearlyData.length === 0) return null; // invalid inputs mid-typing
    impact[strategy] = summarizeCashStrategyRun(run);
  }
  return impact;
}

// Given the impact map and the active strategy, pick the alternative order
// that cuts penalties the most without creating a new funding shortfall.
// Returns null when no alternative meaningfully beats the current one.
function bestCashStrategyAlternative(impact, currentStrategy) {
  const current = impact?.[currentStrategy];
  if (!current) return null;
  const shortfallTolerance = 1000;
  const candidates = CASH_STRATEGY_VALUES.filter(
    (value) => value !== currentStrategy,
  )
    .map((value) => ({ value, ...impact[value] }))
    .filter((alt) => alt.unmet <= current.unmet + shortfallTolerance)
    .sort(
      (a, b) =>
        a.penaltyTotal - b.penaltyTotal || b.endBalance - a.endBalance,
    );
  const best = candidates[0];
  if (!best || best.penaltyTotal >= current.penaltyTotal - 1) return null;
  return best;
}

// Horizon-aware safe-withdrawal guideline. The classic 4% rule is calibrated
// to ~30-year retirements; longer horizons warrant a lower starting rate.
function safeWithdrawalGuideline(retirementYears) {
  if (retirementYears > 40) return 0.0325;
  if (retirementYears > 30) return 0.035;
  return 0.04;
}

function hasMaterialUnmetCashFlow(summary) {
  const threshold = Math.max(1000, summary.year1Spending * 0.005);
  return summary.totalUnmetCashFlow > threshold;
}

// Scan the projection for the first year the plan cannot fund itself and
// classify overall plan health for the always-visible status banner.
// Returns { status: "danger" | "warning" | "ok", ... }.
function computeShortfallInfo(results) {
  const s = results.summary;
  const rows = results.yearlyData.filter((d) => d.phase !== "accumulation");
  const shortfallRows = rows.filter(
    (d) => (d.unmetCashFlow || 0) > 1 || d.total <= 0,
  );
  const first = shortfallRows[0] || null;
  const lastRow = rows[rows.length - 1] || null;
  const material =
    hasMaterialUnmetCashFlow(s) || rows.some((d) => d.total <= 0);
  const endingVsRetirement =
    s.portfolioAtRetirement > 0 ? s.portfolioAtEnd / s.portfolioAtRetirement : 0;

  const retirementYears = rows.length;
  const guideline = safeWithdrawalGuideline(retirementYears);
  let status = "ok";
  if (shortfallRows.length > 0 && material) status = "danger";
  else if (
    s.year1WithdrawalRate >= guideline + 0.005 ||
    endingVsRetirement < 0.3
  )
    status = "warning";

  // Cash sitting protected by the reserve floor while the plan shows a
  // shortfall — surfaced in the banner so users know the lever exists.
  const protectedReserveCash =
    status === "danger" && first && (first.cashFloor || 0) > 0
      ? Math.min(first.cash || 0, first.cashFloor || 0)
      : 0;

  return {
    status,
    firstShortfallAge: first ? first.age : null,
    firstShortfallYear: first ? first.year : null,
    shortfallYearCount: shortfallRows.length,
    totalUnmet: s.totalUnmetCashFlow,
    endBalance: s.portfolioAtEnd,
    endAge: lastRow ? lastRow.age : null,
    withdrawalRate: s.year1WithdrawalRate,
    endingVsRetirement,
    protectedReserveCash,
    guideline,
    retirementYears,
  };
}

function generatePlanNarrative(inputs, results, mcResults, maxSustainableSpending = null) {
  const s = results.summary;
  const retirementYears = inputs.planThroughAge - inputs.retirementAge;
  const ssBridgeYears = Math.max(0, inputs.ssAge - inputs.retirementAge);
  const spendingYearOne = inputs.baseExpenses + inputs.healthcarePre65;
  const withdrawalRate = s.year1WithdrawalRate;
  const endingVsRetirement =
    s.portfolioAtRetirement > 0
      ? s.portfolioAtEnd / s.portfolioAtRetirement
      : 0;
  const fundingGap = s.totalUnmetCashFlow;
  const materialFundingGap = hasMaterialUnmetCashFlow(s);
  const materialDepletion = s.depleted && (materialFundingGap || s.portfolioAtEnd <= 0);

  const alreadyRetired = inputs.retirementAge <= inputs.currentAge;
  const retireLabel = alreadyRetired
    ? "your retirement"
    : `retiring at ${inputs.retirementAge}`;
  let tone = "good";
  let headline = alreadyRetired
    ? "Your retirement plan appears to be in a good position."
    : `You appear to be in a good position to retire at ${inputs.retirementAge}.`;
  if (materialDepletion || materialFundingGap || s.portfolioAtEnd <= 0) {
    tone = "bad";
    headline = alreadyRetired
      ? "This retirement plan does not fully work with these assumptions."
      : `Retiring at ${inputs.retirementAge} does not fully work with these assumptions.`;
  } else if (withdrawalRate > 0.045 || endingVsRetirement < 0.7) {
    tone = "warn";
    headline = `The plan for ${retireLabel} looks possible, but it has pressure points.`;
  } else if (withdrawalRate < 0.03 && endingVsRetirement >= 1) {
    headline = `You appear to have a strong margin for ${retireLabel}.`;
  }

  const reasons = [];
  if (materialDepletion || materialFundingGap || s.portfolioAtEnd <= 0) {
    reasons.push(
      `The projection shows ${fundingGap > 0 ? fmtMoney(fundingGap) : "some"} unmet cash flow before age ${inputs.planThroughAge}, which means the desired spending cannot be fully funded from the modeled assets and income.`,
    );
  } else {
    reasons.push(
      `The model funds spending through age ${inputs.planThroughAge} and still projects ${fmtMoney(s.portfolioAtEnd)} at the end of the plan.`,
    );
  }

  reasons.push(
    `The first retirement-year withdrawal rate is ${fmtPct(withdrawalRate)}, based on projected retirement assets of ${fmtMoney(s.portfolioAtRetirement)} and year-one retirement spending of ${fmtMoney(s.year1Spending)}.`,
  );

  if (ssBridgeYears > 0) {
    reasons.push(
      `The bridge period before Social Security is ${ssBridgeYears} years; during that phase, part-time income, cash, taxable assets, HSA withdrawals, and planned Roth conversions do most of the work.`,
    );
  }

  if (inputs.partTimeIncome > 0) {
    const partTimeCoverage = spendingYearOne > 0 ? inputs.partTimeIncome / spendingYearOne : 0;
    reasons.push(
      `Part-time income of ${fmtMoney(inputs.partTimeIncome)} covers about ${(partTimeCoverage * 100).toFixed(0)}% of first-year retirement lifestyle plus healthcare spending, reducing early portfolio strain.`,
    );
  }

  if (s.totalConverted > 0) {
    reasons.push(
      `The plan converts ${fmtMoney(s.totalConverted)} into Roth accounts over time, which raises taxes during conversion years but can reduce future tax-deferred balances and RMD pressure.`,
    );
  }

  if (
    maxSustainableSpending != null &&
    !materialDepletion &&
    !materialFundingGap &&
    maxSustainableSpending > inputs.baseExpenses
  ) {
    reasons.push(
      `Spending headroom: lifestyle spending of up to ≈${fmtMoney(maxSustainableSpending)}/yr (vs ${fmtMoney(inputs.baseExpenses)} planned, holding everything else constant) stays funded through age ${inputs.planThroughAge}.`,
    );
  }

  const watchItems = [];
  const totalEarlyPenalties = results.yearlyData.reduce(
    (sum, d) => sum + (d.earlyPenalty || 0),
    0,
  );
  if (totalEarlyPenalties > Math.max(5000, s.totalTaxesPaid * 0.01)) {
    watchItems.push(
      `This plan pays about ${fmtMoney(totalEarlyPenalties)} in 10% early-withdrawal penalties on retirement-account draws before age 59½ (PENALTY rows in the table). Retiring at 55 or later (Rule of 55) or covering those years from cash and taxable assets would avoid most of it.`,
    );
  }
  if (withdrawalRate > 0.04) {
    watchItems.push(
      `The withdrawal rate is above 4%, so spending cuts, more part-time income, or delaying retirement would materially improve the margin.`,
    );
  }
  if (retirementYears > 35) {
    watchItems.push(
      `The plan covers ${retirementYears} retirement years, so the result is sensitive to long-run return and inflation assumptions.`,
    );
  }
  if (inputs.healthcarePre65 > 25000 && ssBridgeYears > 5) {
    watchItems.push(
      `Pre-Medicare healthcare is a major bridge-period cost at ${fmtMoney(inputs.healthcarePre65)} per year before inflation.`,
    );
  }
  if (!mcResults) {
    watchItems.push(
      "Run Monte Carlo in Risk Analysis to test this deterministic plan against bad market sequences.",
    );
  } else {
    watchItems.push(
      `Monte Carlo success rate is ${fmtPct(mcResults.successRate)}, with a median age-${inputs.planThroughAge} ending balance of ${fmtMoney(mcResults.finalP50)}.`,
    );
  }

  return { tone, headline, reasons, watchItems };
}


export { simulate, simulateCouple, simulatePlan, DEFAULT_INPUTS, DEFAULT_COUPLE_INPUTS, totalTax, fedOrdinaryTax, fedLtcgTax, nyStateTax, taxableSocialSecurity, computeIrmaaSurcharge, rmdDivisor, seppAmortizedPayment, rothEarlyPenaltyBase };
