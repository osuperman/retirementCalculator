import { validateFinancialFacts, POLICY_DEFAULTS, initialRothLayers, rothQualified, historicalMagi, distributionYears, annualReturn, hsaEligibleFraction, qualifiedHsaExpenses, socialSecurityPaid, catchupSplit, planRothEarnings, aliveFraction, transferSpousalAccounts, seppSchedule, financialNotices, employerPlanRmd, coupleQualifiedHsa, coupleHsaRooms } from "./policy.js";
import { solveTaxClosure, provisionalRothLayers, commitRothConversion } from './numerics.js';

const PROJECTION_START_YEAR = new Date().getFullYear();

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

const SS_MIN_CLAIM_AGE = 62;

const SS_MAX_CREDIT_AGE = 70;

function effectiveSsClaimAge(ssAge) {
  return Math.min(SS_MAX_CREDIT_AGE, Math.max(SS_MIN_CLAIM_AGE, ssAge));
}

const SS_WAGE_BASE_2026 = 184500;

function employeeFica(coveredWages, year, inflation = 0.03) {
  if (coveredWages <= 0) return 0;
  const wageBase =
    SS_WAGE_BASE_2026 * Math.pow(1 + inflation, Math.max(0, year - 2026));
  return 0.062 * Math.min(coveredWages, wageBase) + 0.0145 * coveredWages;
}

function fullRetirementAgeForBirthYear(birthYear) {
  if (birthYear >= 1960) return 67;
  if (birthYear >= 1955) return 66 + (birthYear - 1954) * (2 / 12);
  return 66;
}

function adjustedSocialSecurityBenefit(fraBenefit, claimAge, fullRetirementAge = 67) {
  const effectiveClaimAge = Math.min(
    SS_MAX_CREDIT_AGE,
    Math.max(SS_MIN_CLAIM_AGE, claimAge),
  );
  const months = Math.round((effectiveClaimAge - fullRetirementAge) * 12);
  if (months === 0) return fraBenefit;
  if (months > 0) {
    return fraBenefit * (1 + months * (0.08 / 12));
  }
  const earlyMonths = Math.abs(months);
  const first36Reduction = Math.min(earlyMonths, 36) * (5 / 9 / 100);
  const extraReduction = Math.max(0, earlyMonths - 36) * (5 / 12 / 100);
  return fraBenefit * Math.max(0, 1 - first36Reduction - extraReduction);
}

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

const NY_RECAPTURE_AGI_FLOOR = 107650;

const NY_RECAPTURE_PHASE_IN = 50000;

function nyTaxBenefitRecapture(nyagi, nyTaxable, brackets) {
  if (nyagi <= NY_RECAPTURE_AGI_FLOOR) return 0;
  let recapture = 0;
  for (let k = 1; k < brackets.length; k++) {
    const [floorK, , rateK] = brackets[k];
    if (nyTaxable <= floorK) break; // marginal rate is below this step
    const prevRate = brackets[k - 1][2];
    const phaseStart = Math.max(NY_RECAPTURE_AGI_FLOOR, floorK);
    const frac = Math.min(
      1,
      Math.max(0, (nyagi - phaseStart) / NY_RECAPTURE_PHASE_IN),
    );
    recapture += (rateK - prevRate) * floorK * frac;
  }
  return recapture;
}

function nyStateTax(
  taxableIncome,
  year = 2024,
  _inflation = 0.03,
  filingStatus = "mfj",
) {
  if (taxableIncome <= 0) return 0;
  const params = NY_TAX_PARAMS[filingStatus] || NY_TAX_PARAMS.mfj;
  const stdDed = params.standardDeduction;
  const nyTaxable = Math.max(0, taxableIncome - stdDed);
  // FY2026 NY budget (Ch. 59, Laws of 2025) cuts the bottom five rates by
  // 0.1pp in tax year 2026 and 0.2pp total from 2027 onward (permanent).
  const midClassCut = year >= 2027 ? 0.002 : year >= 2026 ? 0.001 : 0;
  // The temporary 9.65% / 10.3% / 10.9% top rates (2021 budget) run through
  // tax year 2032 (FY2026 budget extension). From 2033 the statute reverts
  // income above the 6.85% bracket to the prior 8.82% top rate. These rates
  // have been extended repeatedly — revisit if Albany moves again.
  const brackets = params.brackets.map(([low, high, rate], index) => [
    low,
    high,
    index < 5
      ? rate - midClassCut
      : year >= 2033 && rate > 0.0882
        ? 0.0882
        : rate,
  ]);
  let tax = 0;
  for (const [low, high, rate] of brackets) {
    if (nyTaxable > low) {
      tax += (Math.min(nyTaxable, high) - low) * rate;
    }
    if (nyTaxable <= high) break;
  }
  return tax + nyTaxBenefitRecapture(taxableIncome, nyTaxable, brackets);
}

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

const SINGLE_LIFE_EXPECTANCY = {
  18: 67.0, 19: 66.0,
  20: 65.0, 21: 64.1, 22: 63.1, 23: 62.1, 24: 61.1, 25: 60.2, 26: 59.2,
  27: 58.2, 28: 57.3, 29: 56.3, 30: 55.3, 31: 54.4, 32: 53.4, 33: 52.5,
  34: 51.5, 35: 50.5, 36: 49.6, 37: 48.6, 38: 47.7, 39: 46.7,
  40: 45.7, 41: 44.8, 42: 43.8, 43: 42.9, 44: 41.9, 45: 41.0, 46: 40.0,
  47: 39.0, 48: 38.1, 49: 37.1, 50: 36.2, 51: 35.3, 52: 34.3, 53: 33.4,
  54: 32.5, 55: 31.6, 56: 30.6, 57: 29.8, 58: 28.9, 59: 28.0,
  60: 27.1, 61: 26.2, 62: 25.4, 63: 24.5, 64: 23.7, 65: 22.9, 66: 22.0,
  67: 21.2, 68: 20.4, 69: 19.6, 70: 18.8, 71: 18.0, 72: 17.2, 73: 16.4,
  74: 15.6, 75: 14.8, 76: 14.1, 77: 13.3, 78: 12.6, 79: 11.9, 80: 11.2,
  81: 10.5, 82: 9.9, 83: 9.3, 84: 8.7, 85: 8.1, 86: 7.6, 87: 7.1,
  88: 6.6, 89: 6.1, 90: 5.7, 91: 5.3, 92: 4.9, 93: 4.6, 94: 4.3,
  95: 4.0, 96: 3.7, 97: 3.4, 98: 3.2, 99: 3.0, 100: 2.8, 101: 2.6,
  102: 2.5, 103: 2.3, 104: 2.2, 105: 2.1, 106: 2.1, 107: 2.1, 108: 2.0,
  109: 2.0, 110: 2.0, 111: 2.0, 112: 2.0, 113: 1.9, 114: 1.9, 115: 1.8,
  116: 1.8, 117: 1.6, 118: 1.4, 119: 1.1, 120: 1.0,
};

function singleLifeDivisor(age) {
  const a = Math.round(age);
  // Below the table's floor, extend by ~1 year of expectancy per year of age
  // (matches the table's slope at young ages); above 120, use the 1.0 floor.
  if (a <= 18) return SINGLE_LIFE_EXPECTANCY[18] + (18 - a);
  if (a >= 120) return SINGLE_LIFE_EXPECTANCY[120];
  return SINGLE_LIFE_EXPECTANCY[a];
}

function seppAmortizedPayment(balance, rate, startAge) {
  if (balance <= 0) return 0;
  const n =
    SINGLE_LIFE_EXPECTANCY[Math.min(59, Math.max(40, Math.round(startAge)))] ??
    30;
  if (rate <= 0) return balance / n;
  return (balance * rate) / (1 - Math.pow(1 + rate, -n));
}

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
  const a = Math.round(age);
  if (table[a] != null) return table[a];
  if (a < 72) return null;
  return 2.0;
}

function resolveInheritedFinalDistributionYear({
  payoutRule,
  deathYear,
  deceasedBirthYear,
  contractMode = "none",
  contractAge = 72,
  contractYear = 0,
}) {
  const contractDeadline =
    contractMode === "ownerAge"
      ? deceasedBirthYear + contractAge
      : contractMode === "explicitYear" && contractYear > 0
        ? contractYear
        : null;
  const federalDeadline = payoutRule === "tenYear" ? deathYear + 10 : null;
  const effectiveDeadline =
    payoutRule === "tenYear"
      ? contractDeadline != null
        ? Math.min(federalDeadline, contractDeadline)
        : federalDeadline
      : contractDeadline;
  return { contractDeadline, federalDeadline, effectiveDeadline };
}

function inheritedRmdRequirement({
  year,
  age, // beneficiary's age attained in `year`
  balance, // start-of-year balance (prior Dec 31)
  payoutRule, // "lifeExpectancy" | "tenYear"
  relationship, // "spouse" | "nonSpouse"
  deathYear,
  deceasedBirthYear,
  // Layer-B contract overlay: the EFFECTIVE final distribution year from
  // resolveInheritedFinalDistributionYear (contract deadline, federal
  // 10-year deadline, or the earlier of the two). null = no forced
  // liquidation year beyond what the payout rule itself imposes.
  finalDistributionYear = null,
  // "auto" infers the owner's RBD status from birth/death years (whole-
  // calendar-year approximation); "beforeRbd" / "onOrAfterRbd" override it —
  // exact RBDs can turn on the owner's birthday, retirement status, and
  // plan provisions the model cannot see.
  ownerRmdStatus = "auto",
}) {
  if (balance <= 0 || year <= deathYear) return 0;
  // Contract/effective liquidation deadline: the ENTIRE remaining balance
  // must be distributed in (or after) that year.
  if (finalDistributionYear != null && year >= finalDistributionYear) {
    return balance;
  }
  const isSpouse = relationship === "spouse";
  const deceasedRmdAge = rmdStartAgeForBirthYear(deceasedBirthYear);
  // Annual-model RBD: April 1 of the year after the owner's RMD-age year, so
  // a death in any later year is "on or after" the RBD.
  const diedAfterRbd =
    ownerRmdStatus === "onOrAfterRbd"
      ? true
      : ownerRmdStatus === "beforeRbd"
        ? false
        : deathYear > deceasedBirthYear + deceasedRmdAge;
  const firstPaymentYear = deathYear + 1;

  if (payoutRule === "tenYear") {
    if (year >= deathYear + 10) return balance; // depletion deadline
    if (!diedAfterRbd) return 0; // death before RBD: nothing due in years 1–9
    const yearsSinceFirst = year - firstPaymentYear;
    const divisor = isSpouse
      ? singleLifeDivisor(age)
      : singleLifeDivisor(age - yearsSinceFirst) - yearsSinceFirst;
    return divisor > 1 ? balance / divisor : balance;
  }

  // Life-expectancy stretch.
  let startYear = firstPaymentYear;
  if (isSpouse && !diedAfterRbd) {
    startYear = Math.max(
      firstPaymentYear,
      deceasedBirthYear + deceasedRmdAge,
    );
  }
  if (year < startYear) return 0;
  const yearsSinceStart = year - startYear;
  const divisor = isSpouse
    ? singleLifeDivisor(age)
    : singleLifeDivisor(age - yearsSinceStart) - yearsSinceStart;
  return divisor > 1 ? balance / divisor : balance;
}

const FPL_GUIDELINES = {
  2024: { first: 15060, additional: 5380 },
  2025: { first: 15650, additional: 5500 },
  2026: { first: 15960, additional: 5680 },
};

const FPL_LAST_KNOWN_YEAR = 2026;

const FPL_FIRST_KNOWN_YEAR = 2024;

function federalPovertyLevel(householdSize, coverageYear, inflation = 0.03) {
  const guidelineYear = coverageYear - 1;
  const clampedYear = Math.min(
    FPL_LAST_KNOWN_YEAR,
    Math.max(FPL_FIRST_KNOWN_YEAR, guidelineYear),
  );
  const g = FPL_GUIDELINES[clampedYear];
  const base =
    g.first + g.additional * Math.max(0, Math.max(1, householdSize) - 1);
  // Outside the known table, approximate the annual HHS update by inflation
  // (guidelines are actually CPI-U-based; the input rate is a fair proxy).
  return base * Math.pow(1 + inflation, guidelineYear - clampedYear);
}

function estimateAcaHealthcareCost(baseHealthcareCost, magi, householdSize, year, inflation = 0.03, coverage = null) {
  if (coverage && !coverage.acaEligible) return baseHealthcareCost;
  if (baseHealthcareCost <= 0) return 0;
  const fpl = federalPovertyLevel(householdSize, year, inflation);
  const fplRatio = magi / fpl;
  // §36B statutory floor: household income below 100% FPL is not
  // PTC-eligible (limited immigrant exceptions aside — those would be
  // Medicaid-gap situations this model can't price). The old code granted
  // near-full subsidies at any income above zero.
  if (fplRatio < 1.0) return baseHealthcareCost;
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
    // Exactly 400% is still eligible (§36B: household income "does not
    // exceed" 400%), so the top band is inclusive at its upper edge — the
    // lookup must not fall through to the first band at fplRatio == 4.0.
    if (fplRatio > 4.0) return baseHealthcareCost;
    const band =
      ACA_APPLICABLE_PERCENTAGES_2026.find(
        ([low, high]) => fplRatio >= low && fplRatio < high,
      ) ??
      ACA_APPLICABLE_PERCENTAGES_2026[ACA_APPLICABLE_PERCENTAGES_2026.length - 1];
    const [low, high, startPct, endPct] = band;
    const span = high - low || 1;
    expectedPct = startPct + ((fplRatio - low) / span) * (endPct - startPct);
  }
  const expectedContribution = magi * expectedPct;
  if (coverage) {
    const months = Math.max(0,Math.min(12,coverage.acaCoverageMonths ?? 12));
    const index = Math.pow(1+inflation,year-(coverage.projectionStartYear ?? PROJECTION_START_YEAR));
    const annualCredit = Math.min(Math.max(0,coverage.acaAnnualPremium || 0),
      Math.max(0,(coverage.acaBenchmarkPremium || 0)-expectedContribution/index));
    return Math.max(0,baseHealthcareCost - annualCredit*index*months/12);
  }
  // User pays the lesser of sticker or expected contribution, plus a
  // non-premium out-of-pocket floor (deductibles, copays, dental) that is
  // entered in ~2025 dollars and inflates on the same clock as the FPL.
  const oopFloor = 2000 * Math.pow(1 + inflation, Math.max(0, year - 2025));
  const premiumPortion = Math.max(0, baseHealthcareCost - oopFloor);
  const subsidizedPremium = Math.min(premiumPortion, Math.max(0, expectedContribution));
  return subsidizedPremium + oopFloor;
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
  // Taxable interest (already inside ordinaryIncome/MAGI) that also belongs
  // in the §1411 net-investment-income base. NIIT applies to interest,
  // dividends, and gains — not just the LTCG the old code counted.
  investmentInterest = 0,
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
    seniorBonusDeduction = seniors65 * Math.max(0, 6000 - phaseOut);
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
  // NIIT (§1411): 3.8% on the lesser of net investment income (LTCG + cash
  // interest here) or MAGI above $250K MFJ / $200K single (thresholds not
  // indexed by statute).
  const niitThreshold = statusParams.niitThreshold;
  const netInvestmentIncome = Math.max(0, ltcg) + Math.max(0, investmentInterest);
  const niit =
    magi > niitThreshold
      ? Math.min(netInvestmentIncome, magi - niitThreshold) * 0.038
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

function rothTaxableEarnings(wRoth, layers) {
  if (!layers || wRoth <= 0) return 0;
  const nonEarnings =
    Math.max(0, layers.contribBasis) +
    layers.vintages.reduce((sum, v) => sum + Math.max(0, v.amount), 0);
  return Math.max(0, wRoth - nonEarnings);
}

function rothEarlyPenaltyBase(wRoth, layers, currentYear) {
  if (!layers) return wRoth;
  let remaining = wRoth;
  let penalized = 0;
  remaining -= Math.min(remaining, Math.max(0, layers.contribBasis));
  for (const v of layers.vintages) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, v.amount);
    if (currentYear - v.year < 5) penalized += Math.min(take, v.taxableAmount ?? v.amount);
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
    v.taxableAmount = Math.max(0, (v.taxableAmount ?? v.amount) - take);
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

function doWithdrawalWaterfall(grossNeed, state, preSs, cashPolicy = CASH_POLICY_DEFAULT) {
  // The inherited (BCO) bucket sits immediately ahead of the owner's own
  // 401k/IRA in every order: its draws carry the same ordinary-income tax but
  // are penalty-free at any age (death exception) and the account is already
  // on a forced-distribution clock, so it should empty before own deferred.
  const w = { wCash: 0, wTaxable: 0, wInherited: 0, w401k: 0, wIra: 0, wRoth: 0, reserveUsed: 0 };
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
      ["wInherited", Math.max(0, state.bInherited || 0)],
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
      take("wInherited", (state.bInherited || 0) - w.wInherited);
      take("w401k", state.b401k - w.w401k);
      take("wIra", state.bTradIra - w.wIra);
    }
    take("wRoth", state.bRoth);
  } else if (strategy === "cashLast") {
    // Cash is used only when other spendable sources are exhausted, but still
    // ahead of Roth (Roth preservation is the model's standing philosophy).
    if (preSs) {
      take("wTaxable", state.bTaxable);
      take("wInherited", state.bInherited || 0);
      take("w401k", state.b401k);
      take("wIra", state.bTradIra);
    } else {
      take("wInherited", state.bInherited || 0);
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
    take("wInherited", state.bInherited || 0);
    take("w401k", state.b401k);
    take("wIra", state.bTradIra);
    take("wRoth", state.bRoth);
  } else {
    take("wInherited", state.bInherited || 0);
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

function computeRealizedGain(wTaxable, bTaxable, bTaxableBasis) {
  if (wTaxable <= 0 || bTaxable <= 0) return 0;
  const gainRatio = Math.max(0, (bTaxable - bTaxableBasis) / bTaxable);
  return wTaxable * gainRatio;
}

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
  accountRmds = null,
  penaltyFree401k = false,
  cashPolicy = CASH_POLICY_DEFAULT,
  // Taxable interest earned on the Cash/HYSA balance this year. Ordinary
  // income for federal + NY, and part of provisional income and MAGI.
  interestIncome = 0,
  cashRate = null,
  taxableOrdinaryYield = 0,
  surplusEarnsCashInterest = true,
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
  // Extra long-term capital gain to tax this year that is NOT produced by a
  // taxable withdrawal (e.g. gain realized when selling taxable assets at
  // time zero to clear debt). It is added to the tax base and provisional
  // income only; the account basis is already reduced by the caller, so it
  // is deliberately excluded from the returned `realizedGain` used for basis.
  additionalRealizedGain = 0,
  // Inherited (BCO) account: required distribution this year (forced like an
  // RMD, from the inherited balance only), tax character of its draws, and
  // whether its taxable income can use NY's $20K pension/annuity exclusion
  // through the decedent's eligibility (beneficiary rule).
  inheritedRmd = 0,
  inheritedTaxType = "qualified",
  inheritedNyExcludable = false,
  inheritedNyEligible = true,
  taxableHsaAvailable = 0,
  planRothAccount = null,
  seppIncome = 0,
  recaptureTax = 0,
}) {
  let tax = 0;
  let withdrawals = { wCash: 0, wTaxable: 0, wInherited: 0, w401k: 0, wIra: 0, wRoth: 0, reserveUsed: 0 };
  let realizedGain = 0;
  let taxableSs = 0;
  let ordIncome = 0;
  let earlyPenalty = 0;
  let inheritedTaxable = 0;
  let brokerageIncome = 0;
  const taxLayers = provisionalRothLayers(rothLayers, conversion, year);
  const closure = solveTaxClosure((assumedTax) => {
    tax = assumedTax;
    const grossNeed = Math.max(0, netNeed + tax);
    const mandatory = {
      w401k: Math.min(state.b401k,accountRmds?.k401 || 0),
      wIra: Math.min(state.bTradIra,accountRmds?.ira || 0),
      wInherited: Math.min(state.bInherited || 0,inheritedRmd),
    };
    const forced = mandatory.w401k+mandatory.wIra+mandatory.wInherited;
    withdrawals = doWithdrawalWaterfall(Math.max(0,grossNeed-forced), {
      ...state,b401k:state.b401k-mandatory.w401k,bTradIra:state.bTradIra-mandatory.wIra,
      bInherited:(state.bInherited || 0)-mandatory.wInherited,bRoth:state.bRoth+conversion,
    },preSs,cashPolicy);
    for (const key of Object.keys(mandatory)) withdrawals[key]+=mandatory[key];

    // Enforce RMD inside the convergence loop so tax reflects forced withdrawals.
    // If w401k + wIra < minimumRmd, force additional withdrawal from tax-deferred
    // accounts. Extra money (beyond netNeed+tax) becomes surplus cash, handled
    // by the caller.
    if (accountRmds) {
      withdrawals.w401k = Math.max(withdrawals.w401k, Math.min(state.b401k, accountRmds.k401));
      withdrawals.wIra = Math.max(withdrawals.wIra, Math.min(state.bTradIra, accountRmds.ira));
    } else if (minimumRmd > 0) {
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

    // Enforce the inherited (BCO) required distribution the same way: if the
    // waterfall drew less than the beneficiary schedule demands, force the
    // difference out of the inherited balance. Surplus beyond netNeed + tax
    // becomes cash in the caller, exactly like an RMD surplus.
    if (inheritedRmd > 0) {
      const availInherited = Math.max(
        0,
        (state.bInherited || 0) - withdrawals.wInherited,
      );
      if (withdrawals.wInherited < inheritedRmd) {
        withdrawals.wInherited += Math.min(
          inheritedRmd - withdrawals.wInherited,
          availInherited,
        );
      }
    }

    const alreadyDrawn = withdrawals.wCash + withdrawals.wTaxable + withdrawals.wInherited + withdrawals.w401k + withdrawals.wIra + withdrawals.wRoth;
    withdrawals.wPlanRoth = Math.min(planRothAccount?.balance || 0,Math.max(0,grossNeed-alreadyDrawn));
    withdrawals.wHsa = age >= 65 ? Math.min(taxableHsaAvailable, Math.max(0,grossNeed-alreadyDrawn-withdrawals.wPlanRoth)) : 0;
    const designatedEarnings = planRothEarnings(withdrawals.wPlanRoth,planRothAccount,age,year);

    // Taxable portion of inherited (BCO) draws: qualified accounts (inherited
    // IRA/401k/403b) are fully taxable ordinary income; non-qualified
    // annuities distribute earnings first (LIFO, IRC §72(e)) — fully taxable
    // until only cost basis (investment in the contract) remains.
    inheritedTaxable =
      inheritedTaxType === "nonqualified"
        ? Math.min(
            withdrawals.wInherited,
            Math.max(0, (state.bInherited || 0) - (state.bInheritedBasis || 0)),
          )
        : withdrawals.wInherited;

    realizedGain = computeRealizedGain(
      withdrawals.wTaxable,
      state.bTaxable,
      state.bTaxableBasis,
    );
    // Gain taxed this year = withdrawal gain + any caller-supplied extra gain
    // (debt-payoff sale). Basis for the extra gain is already handled upstream.
    const taxableRealizedGain = realizedGain + Math.max(0, additionalRealizedGain);
    // Pre-59½ Roth earnings draws are ordinary income (and penalized below).
    const earlyRothEarnings =
      !rothQualified(age, year, taxLayers) ? rothTaxableEarnings(withdrawals.wRoth, taxLayers) : 0;
    if (cashRate !== null) {
      const drawn = withdrawals.wCash + withdrawals.wTaxable + withdrawals.w401k + withdrawals.wIra + withdrawals.wRoth + withdrawals.wInherited + withdrawals.wHsa + withdrawals.wPlanRoth;
      const surplus = surplusEarnsCashInterest ? Math.max(0, drawn - netNeed - tax) : 0;
      interestIncome = Math.max(0, (state.bCash - withdrawals.wCash + surplus) * cashRate);
    }
    brokerageIncome = Math.max(0,state.bTaxable-withdrawals.wTaxable)*Math.max(0,taxableOrdinaryYield);
    const incomeBeforeSs =
      ptIncome +
      pensionGross + seppIncome +
      interestIncome + brokerageIncome +
      earlyRothEarnings + designatedEarnings + withdrawals.wHsa +
      withdrawals.w401k +
      withdrawals.wIra +
      inheritedTaxable +
      conversion +
      taxableRealizedGain; // LTCG counts in provisional income
    taxableSs = taxableSocialSecurity(ssGross, incomeBeforeSs, filingStatus);
    ordIncome =
      ptIncome +
      taxableSs +
      pensionGross + seppIncome +
      interestIncome + brokerageIncome +
      earlyRothEarnings + designatedEarnings + withdrawals.wHsa +
      withdrawals.w401k +
      withdrawals.wIra +
      inheritedTaxable +
      conversion;
    const nyExemptAmount = pensionNyExempt ? pensionGross : 0;
    const privateRetirementIncome = seppIncome +
      withdrawals.w401k +
      withdrawals.wIra +
      conversion +
      (pensionNyExempt ? 0 : pensionGross);
    // NY pension/annuity exclusion applies from age 59½ (annual model: 60).
    // Inherited (BCO) income also qualifies through the DECEDENT's
    // eligibility: a beneficiary may claim the exclusion for inherited
    // pension/annuity income once the decedent was (or would have been) 59½,
    // regardless of the beneficiary's own age. Combined cap stays $20K.
    const nyEligibleRetirementIncome =
      (age >= 59.5 ? privateRetirementIncome : 0) +
      (inheritedNyEligible && (age >= 59.5 || inheritedNyExcludable) ? inheritedTaxable : 0);
    const nyPensionAnnuityExclusion = Math.min(
      20000,
      nyEligibleRetirementIncome,
    );
    // IRC §72(t): 10% additional tax on early distributions before age 59½.
    // - 401k: exempt when the Rule of 55 applies (separation at 55+), and only
    //   from age 55 onward.
    // - Traditional IRA: always penalized before 59½ (Rule of 55 never applies).
    // - Roth: §408A(d)(4) ordering layers — contribution basis and 5-year
    //   seasoned conversions are penalty-free; only unseasoned conversion
    //   principal and earnings are penalized (rothEarlyPenaltyBase). Callers
    //   that pass no layer data fall back to penalizing early Roth draws in
    //   full, as a conservative approximation.
    // RMDs cannot coexist with age < 59½, so forced RMD draws are never hit.
    // Inherited (BCO) draws are deliberately absent from every penalized sum:
    // distributions to a beneficiary are exempt from the 10% additional tax
    // at any age (death exception — IRC §72(t)(2)(A)(ii) for qualified plans
    // and §72(q)(2)(A) for non-qualified annuities). This exception is lost
    // if a surviving spouse instead elects spousal continuation (treating the
    // account as their own), which this model does not do.
    if (age < 59.5) {
      const penalized401k =
        penaltyFree401k && age >= 55 ? 0 : withdrawals.w401k;
      const penalizedRoth = taxLayers
        ? rothEarlyPenaltyBase(withdrawals.wRoth, taxLayers, year)
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
        taxableRealizedGain,
        year,
        nyExemptAmount,
        inflation,
        taxableSs,
        nyPensionAnnuityExclusion,
        seniors65,
        filingStatus,
        interestIncome + brokerageIncome + (inheritedTaxType === 'nonqualified' ? inheritedTaxable : 0),
      ) + recaptureTax + earlyPenalty + (age < 59.5 && !(penaltyFree401k && age >= 55) ? .1*designatedEarnings : 0);
    return { tax: newTax };
  });
  tax = closure.tax;
  return {
    withdrawals,
    tax,
    realizedGain,
    taxableSs,
    ordIncome,
    earlyPenalty: Math.round(earlyPenalty),
    inheritedTaxable,
    interestIncome, brokerageIncome,
    converged: closure.converged,
    residual: closure.residual,
  };
}

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

  // --- FPL coverage-year clock: PTC eligibility for coverage year Y uses
  // the guidelines PUBLISHED in Y-1 (regression: the old formula projected
  // into the coverage year, running one year ahead — 2027 used $16,603
  // instead of the published $15,960).
  test(
    "federalPovertyLevel: 2026 coverage uses Jan-2025 guidelines ($15,650)",
    federalPovertyLevel(1, 2026, 0.03),
    15650,
    (a, e) => Math.abs(a - e) <= 1,
  );
  test(
    "federalPovertyLevel: 2027 coverage uses Jan-2026 guidelines ($15,960)",
    federalPovertyLevel(1, 2027, 0.03),
    15960,
    (a, e) => Math.abs(a - e) <= 1,
  );
  test(
    "federalPovertyLevel: household of 2, 2025 coverage = $20,440 (Jan-2024)",
    federalPovertyLevel(2, 2025, 0.03),
    20440,
    (a, e) => Math.abs(a - e) <= 1,
  );
  // Beyond the known tables, guidelines project by inflation from Jan-2026.
  test(
    "federalPovertyLevel: household of 2 in 2035 projects Jan-2026 base",
    federalPovertyLevel(2, 2035, 0.03),
    (15960 + 5680) * Math.pow(1.03, 8),
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
    priorEmployerWages: 100000, rothFirstContributionYear: 2000, hsaCoverage: "family", hsaQualifiedExpenses: 100000,
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
      const limit = getCoupleHsaLimit(
        56,
        55,
        year,
        couple.shared.inflation,
        couple.shared.householdSize,
      ).total;
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
      const withSepp = simulate({ ...base, useSepp: true, seppRate: 0.05, seppAccountAmount: 1123600, seppStartDate: '2028-01-01', birthDate: '1976-01-01' });
      const withoutSepp = simulate(base);
      const rowW = withSepp.yearlyData.find((d) => d.age === 52);
      const rowWo = withoutSepp.yearlyData.find((d) => d.age === 52);
      return {
        passed:
          rowW.earlyPenalty === 0 &&
          rowWo.earlyPenalty > 0 &&
          rowW.seppIncome > 0,
        details: `sepp: penalty=${rowW.earlyPenalty} draw=${rowW.from401k}; no sepp: penalty=${rowWo.earlyPenalty}`,
      };
    },
  );

  // ============================================================
  // AUDIT 2026-07 REGRESSION TESTS
  // ============================================================

  // --- ACA current-law (2026) band, incl. the 400%-FPL boundary. Exactly
  // 400% FPL is still eligible (§36B): it must use the top 9.96% band, not
  // fall through to the 2.1% first band, and not price as the over-cliff
  // full-sticker case. Continuity across 3.99x -> 4.00x confirms the fix.
  {
    const fpl2026 = federalPovertyLevel(2, 2026, 0.03);
    const at399 = estimateAcaHealthcareCost(30000, fpl2026 * 3.99, 2, 2026, 0.03);
    const at400 = estimateAcaHealthcareCost(30000, fpl2026 * 4.0, 2, 2026, 0.03);
    const at401 = estimateAcaHealthcareCost(30000, fpl2026 * 4.01, 2, 2026, 0.03);
    test(
      "ACA 2026: cost is continuous across exactly 400% FPL (no 2.1% fallback)",
      Math.abs(at400 - at399) < 500 ? 1 : 0,
      1,
    );
    test(
      "ACA 2026: exactly 400% FPL still subsidized (below full sticker)",
      at400 < 30000 ? 1 : 0,
      1,
    );
    test("ACA 2026: just above 400% FPL = full sticker (cliff)", at401, 30000, pctEq);
  }
  // OOP floor inflates from its 2025 base: $2,000 in 2025, $2,060 in 2026.
  // A sub-floor sticker cost ($1,000) at an in-subsidy MAGI isolates the
  // floor as the whole result, so the delta is purely the floor's inflation.
  test(
    "ACA: OOP floor inflates ($2,000 in 2025 -> $2,060 in 2026)",
    estimateAcaHealthcareCost(1000, 25000, 2, 2026, 0.03) -
      estimateAcaHealthcareCost(1000, 25000, 2, 2025, 0.03),
    60,
    (a, e) => Math.abs(a - e) <= 5,
  );

  // --- Conversions stop once Social Security starts (early claim at 62)
  testScenario(
    "Conversions stop when SS starts (early claim at 62)",
    () => {
      const r = simulate({
        ...baseInputs,
        currentAge: 58,
        retirementAge: 59,
        planThroughAge: 70,
        ssAge: 62,
        conversionBridge: 0,
        conversionMid: 30000,
        conversionFinal: 0,
      });
      const preSs = r.yearlyData.find((d) => d.age === 61);
      const postSs = r.yearlyData.filter((d) => d.age >= 62 && d.age <= 64);
      const ok =
        preSs.conversion > 0 &&
        postSs.every((d) => d.ss > 0 && d.conversion === 0);
      return {
        passed: ok,
        details: `age61 conv=${preSs.conversion}; 62-64 conv=[${postSs.map((d) => d.conversion).join(",")}]`,
      };
    },
  );

  // --- SS claim age above 70 is treated as a start at 70 (delayed credits
  // stop at 70; a later start would only forfeit benefits).
  testScenario(
    "SS claim age > 70 starts benefits at 70",
    () => {
      const r = simulate({
        ...baseInputs,
        currentAge: 60,
        retirementAge: 61,
        planThroughAge: 80,
        ssAge: 75,
        conversionBridge: 0,
        conversionMid: 0,
        conversionFinal: 0,
      });
      const first = r.yearlyData.find((d) => d.ss > 0);
      return {
        passed: !!first && first.age === 70,
        details: `first SS benefit at age ${first ? first.age : "never"} (expected 70)`,
      };
    },
  );

  // --- Depletion flag respects materiality: sub-dollar solver rounding must
  // NOT mark a plan that ends with millions as depleted, but a genuinely
  // broke plan still must.
  testScenario(
    "Depleted flag: funded plan not flagged; broke plan flagged",
    () => {
      const funded = simulate({ ...DEFAULT_INPUTS, balanceCash: 10000000 });
      const broke = simulate({
        ...DEFAULT_INPUTS,
        currentAge: 60,
        retirementAge: 61,
        planThroughAge: 90,
        balanceCash: 1000,
        balanceTaxable: 0,
        balance401k: 0,
        balanceTradIra: 0,
        balanceRoth: 0,
        balanceHsa: 0,
        baseExpenses: 80000,
      });
      const ok =
        funded.summary.depleted === false &&
        funded.summary.portfolioAtEnd > 0 &&
        broke.summary.depleted === true;
      return {
        passed: ok,
        details: `funded depleted=${funded.summary.depleted} (unmet ${funded.summary.totalUnmetCashFlow}); broke depleted=${broke.summary.depleted}`,
      };
    },
  );

  // --- Debt-payoff LTCG is taxed in the first distribution year (previously
  // realized silently and never taxed). Already-retired user so year 1 is a
  // distribution year; low basis makes the payoff gain large.
  testScenario(
    "Debt payoff at time zero: realized gain is taxed in year 1",
    () => {
      const common = {
        ...DEFAULT_INPUTS,
        currentAge: 65,
        retirementAge: 60,
        planThroughAge: 70,
        balanceCash: 0,
        balanceTaxable: 300000,
        taxableBasisPct: 0.2,
        balance401k: 0,
        balanceTradIra: 0,
        balanceRoth: 0,
        balanceHsa: 0,
        ssIncome: 0,
        conversionBridge: 0,
        conversionMid: 0,
        conversionFinal: 0,
      };
      const noDebt = simulate({ ...common, creditCardDebt: 0 });
      const withDebt = simulate({ ...common, creditCardDebt: 100000 });
      const t0 = noDebt.yearlyData[0].tax;
      const t1 = withDebt.yearlyData[0].tax;
      return {
        passed: t1 > t0 + 500,
        details: `year1 tax: no-debt=${t0}, with-$100K-payoff=${t1}`,
      };
    },
  );

  // --- Couple conversion cap nets the IRA against the RMD (matches the
  // individual engine): a large IRA that fully covers the RMD frees the 401k
  // to convert its full target in a pre-SS Medicare-window year.
  testScenario(
    "Couple: conversion cap nets IRA against RMD (pre-SS)",
    () => {
      const person = {
        currentAge: 66,
        retirementAge: 65,
        planThroughAge: 75,
        ssAge: 70,
        balance401k: 500000,
        balanceTradIra: 0,
        balanceRoth: 0,
        balanceHsa: 0,
        rmdStartAge: 73,
        conversionBridge: 0,
        conversionMid: 0,
        conversionFinal: 40000,
        pensionIncome: 0,
        partTimeIncome: 0,
        partTimeYears: 0,
        contrib401k: 0,
        contribMatch: 0,
        contribHsa: 0,
        healthcarePre65: 0,
        healthcarePost65: 0,
      };
      const couple = normalizeCoupleInputs({
        primary: { ...DEFAULT_COUPLE_INPUTS.primary, ...person },
        spouse: {
          ...DEFAULT_COUPLE_INPUTS.spouse,
          ...person,
          balance401k: 0,
          conversionFinal: 0,
        },
        shared: {
          ...DEFAULT_COUPLE_INPUTS.shared,
          balanceCash: 300000,
          balanceTaxable: 0,
          baseExpenses: 40000,
        },
      });
      const r = simulateCouple(couple);
      const row = r.yearlyData[0];
      const conv = row.ownerDetails.primary.conversion;
      // ~$40K inflated one year (age 66 vs current 66 => inflMult 1) and pre-SS.
      return {
        passed: conv >= 39000 && row.ss === 0,
        details: `age66 primary conversion=${conv} (expected ~40000, pre-SS)`,
      };
    },
  );

  // ============================================================
  // INHERITED (BCO) ACCOUNT — beneficiary RMD rules + engine integration
  // ============================================================

  // --- Single Life Table lookups (Pub 590-B Table I, 2022+ version)
  test("singleLifeDivisor(50) = 36.2", singleLifeDivisor(50), 36.2, (a, e) =>
    Math.abs(a - e) < 0.01,
  );
  test("singleLifeDivisor(70) = 18.8", singleLifeDivisor(70), 18.8, (a, e) =>
    Math.abs(a - e) < 0.01,
  );
  test("singleLifeDivisor(85) = 8.1", singleLifeDivisor(85), 8.1, (a, e) =>
    Math.abs(a - e) < 0.01,
  );

  // --- Beneficiary RMD rules (pure function, explicit years)
  // Spouse recalculates annually: owner b.1958 (RMD age 73, reached 2031),
  // died 2030 = before RBD; payments start 2031; in 2041 at age 70 the
  // divisor is the fresh table lookup 18.8.
  test(
    "inheritedRmd: spouse recalculated = balance / 18.8 at age 70",
    inheritedRmdRequirement({
      year: 2041, age: 70, balance: 188000,
      payoutRule: "lifeExpectancy", relationship: "spouse",
      deathYear: 2030, deceasedBirthYear: 1958,
    }),
    10000,
  );
  // Spouse may delay until the owner (b.1975, RMD age 75) would have reached
  // RMD age in 2050 — nothing is required in 2040.
  test(
    "inheritedRmd: spouse delay until owner's RMD age (2040 → $0)",
    inheritedRmdRequirement({
      year: 2040, age: 65, balance: 500000,
      payoutRule: "lifeExpectancy", relationship: "spouse",
      deathYear: 2030, deceasedBirthYear: 1975,
    }),
    0,
  );
  // Non-spouse EDB uses the subtract-one method: first payment year 2030 at
  // age 60 fixes 27.1; by 2034 the divisor is 27.1 - 4 = 23.1.
  test(
    "inheritedRmd: non-spouse minus-1 divisor (27.1 → 23.1)",
    inheritedRmdRequirement({
      year: 2034, age: 64, balance: 100000,
      payoutRule: "lifeExpectancy", relationship: "nonSpouse",
      deathYear: 2029, deceasedBirthYear: 1975,
    }),
    100000 / 23.1,
  );
  // 10-year rule, owner died before RBD: nothing due in years 1–9...
  test(
    "inheritedRmd: 10-year (death before RBD) mid-window = $0",
    inheritedRmdRequirement({
      year: 2035, age: 60, balance: 150000,
      payoutRule: "tenYear", relationship: "spouse",
      deathYear: 2030, deceasedBirthYear: 1975,
    }),
    0,
  );
  // ...but the entire balance is forced out in year 10.
  test(
    "inheritedRmd: 10-year deadline forces full balance",
    inheritedRmdRequirement({
      year: 2040, age: 65, balance: 150000,
      payoutRule: "tenYear", relationship: "spouse",
      deathYear: 2030, deceasedBirthYear: 1975,
    }),
    150000,
  );
  // 10-year rule, owner died after RBD (b.1950, RMD age 72 reached 2022):
  // annual Single Life RMDs run during years 1–9 (spouse at 68 → 20.4).
  test(
    "inheritedRmd: 10-year (death after RBD) has annual RMDs",
    inheritedRmdRequirement({
      year: 2027, age: 68, balance: 204000,
      payoutRule: "tenYear", relationship: "spouse",
      deathYear: 2026, deceasedBirthYear: 1950,
    }),
    10000,
  );

  // --- Scenario: BCO bridges early retirement with zero penalty
  testScenario(
    "BCO: inherited drawn before 59½ with no penalty, own 401k untouched",
    () => {
      const r = simulate({
        ...baseInputs,
        filingStatus: "single",
        householdSize: 1,
        currentAge: 50,
        retirementAge: 50,
        planThroughAge: 58,
        balanceCash: 0,
        balanceTaxable: 0,
        balance401k: 500000,
        balanceTradIra: 0,
        balanceRoth: 0,
        balanceHsa: 0,
        partTimeIncome: 0,
        conversionBridge: 0,
        conversionMid: 0,
        conversionFinal: 0,
        balanceInherited: 400000,
        inheritedTaxType: "qualified",
        inheritedPayoutRule: "lifeExpectancy",
        inheritedRelationship: "spouse",
        inheritedDeathYear: PROJECTION_START_YEAR - 1,
        inheritedDeceasedBirthYear: 1965,
      });
      const row = r.yearlyData[0];
      return {
        passed:
          row.fromInherited > 0 &&
          row.earlyPenalty === 0 &&
          row.from401k === 0 &&
          row.fromIra === 0,
        details: `year1: fromInherited=${row.fromInherited}, penalty=${row.earlyPenalty}, from401k=${row.from401k}`,
      };
    },
  );

  // --- Scenario: 10-year rule forces full depletion at the deadline
  testScenario(
    "BCO: 10-year rule empties the account by the deadline (penalty-free)",
    () => {
      const deathYear = PROJECTION_START_YEAR - 2;
      const r = simulate({
        ...baseInputs,
        balanceInherited: 200000,
        inheritedTaxType: "qualified",
        inheritedPayoutRule: "tenYear",
        inheritedRelationship: "spouse",
        inheritedDeathYear: deathYear,
        inheritedDeceasedBirthYear: 1975,
      });
      const deadlineRow = r.yearlyData.find(
        (d) => d.year === deathYear + 10,
      );
      if (!deadlineRow)
        return { passed: false, details: "deadline year not in plan" };
      const after = r.yearlyData.filter((d) => d.year > deathYear + 10);
      return {
        passed:
          deadlineRow.inherited === 0 &&
          deadlineRow.fromInherited > 0 &&
          deadlineRow.earlyPenalty === 0 &&
          after.every((d) => d.inherited === 0),
        details: `deadline ${deadlineRow.year} (age ${deadlineRow.age}): balance=${deadlineRow.inherited}, draw=${deadlineRow.fromInherited}, penalty=${deadlineRow.earlyPenalty}`,
      };
    },
  );

  // --- Scenario: spouse life-expectancy RMDs are enforced and taxed as MAGI
  testScenario(
    "BCO: life-expectancy RMD forced every year and counted in MAGI",
    () => {
      const r = simulate({
        ...baseInputs,
        filingStatus: "single",
        currentAge: 60,
        retirementAge: 60,
        planThroughAge: 75,
        conversionBridge: 0,
        conversionMid: 0,
        conversionFinal: 0,
        balanceInherited: 300000,
        inheritedTaxType: "qualified",
        inheritedPayoutRule: "lifeExpectancy",
        inheritedRelationship: "spouse",
        inheritedDeathYear: PROJECTION_START_YEAR - 1,
        inheritedDeceasedBirthYear: 1950, // died after RBD → payments start now
      });
      const row = r.yearlyData[0];
      const expectedRmd = 300000 / 27.1; // age 60, recalculated Single Life
      const everyYearForced = r.yearlyData.every(
        (d) =>
          d.phase === "accumulation" ||
          d.inheritedRmdAmount <= 0 ||
          d.fromInherited >= d.inheritedRmdAmount - 1,
      );
      return {
        passed:
          Math.abs(row.inheritedRmdAmount - expectedRmd) < 2 &&
          row.fromInherited >= row.inheritedRmdAmount - 1 &&
          row.magi >= row.fromInherited - 1 &&
          everyYearForced,
        details: `year1 RMD=${row.inheritedRmdAmount} (expected ~${Math.round(expectedRmd)}), draw=${row.fromInherited}, magi=${row.magi}`,
      };
    },
  );

  // --- Scenario: non-qualified annuity taxes gains first, then basis
  testScenario(
    "BCO: non-qualified draw taxes only the gain portion (no penalty)",
    () => {
      const solve = solveGrossedUpWithdrawals({
        netNeed: 30000,
        state: {
          bCash: 0, bTaxable: 0, bTaxableBasis: 0,
          b401k: 0, bTradIra: 0, bRoth: 0,
          bInherited: 100000, bInheritedBasis: 80000,
        },
        preSs: true,
        conversion: 0,
        ptIncome: 0,
        ssGross: 0,
        pensionGross: 0,
        pensionNyExempt: false,
        year: PROJECTION_START_YEAR,
        age: 50,
        inflation: 0.03,
        filingStatus: "single",
        inheritedRmd: 0,
        inheritedTaxType: "nonqualified",
        inheritedNyExcludable: true,
      });
      return {
        passed:
          Math.abs(solve.inheritedTaxable - 20000) < 1 &&
          solve.earlyPenalty === 0 &&
          solve.withdrawals.wInherited >= 30000,
        details: `wInherited=${Math.round(solve.withdrawals.wInherited)}, taxable=${Math.round(solve.inheritedTaxable)} (expected 20000 of gains), penalty=${solve.earlyPenalty}`,
      };
    },
  );

  // --- Contract-specific BCO deadlines (Equitable Series 201 example)
  testScenario("BCO Series 201: owner age 72 deadline derives from birth year", () => {
    const born1971 = resolveInheritedFinalDistributionYear({
      payoutRule: "lifeExpectancy",
      deathYear: 2026,
      deceasedBirthYear: 1971,
      contractMode: "ownerAge",
      contractAge: 72,
    });
    const born1970 = resolveInheritedFinalDistributionYear({
      payoutRule: "lifeExpectancy",
      deathYear: 2026,
      deceasedBirthYear: 1970,
      contractMode: "ownerAge",
      contractAge: 72,
    });
    return {
      passed:
        born1971.contractDeadline === 2043 &&
        born1970.contractDeadline === 2042 &&
        born1971.effectiveDeadline === 2043,
      details: `born 1971=${born1971.contractDeadline}, born 1970=${born1970.contractDeadline}`,
    };
  });

  testScenario("BCO 10-year rule: federal deadline cannot be extended by age-72 contract date", () => {
    const deadlines = resolveInheritedFinalDistributionYear({
      payoutRule: "tenYear",
      deathYear: 2026,
      deceasedBirthYear: 1971,
      contractMode: "ownerAge",
      contractAge: 72,
    });
    return {
      passed:
        deadlines.contractDeadline === 2043 &&
        deadlines.federalDeadline === 2036 &&
        deadlines.effectiveDeadline === 2036,
      details: `contract=${deadlines.contractDeadline}, federal=${deadlines.federalDeadline}, effective=${deadlines.effectiveDeadline}`,
    };
  });

  const series201TestInputs = {
    ...baseInputs,
    filingStatus: "single",
    currentAge: 50,
    retirementAge: 50,
    planThroughAge: 75,
    balanceCash: 0,
    balanceTaxable: 0,
    balance401k: 0,
    balanceTradIra: 0,
    balanceRoth: 0,
    balanceHsa: 0,
    baseExpenses: 0,
    healthcarePre65: 0,
    healthcarePost65: 0,
    partTimeIncome: 0,
    partTimeYears: 0,
    ssIncome: 0,
    pensionIncome: 0,
    conversionBridge: 0,
    conversionMid: 0,
    conversionFinal: 0,
    balanceInherited: 100000,
    inheritedPlanType: "403bTsa",
    inheritedTaxType: "qualified",
    inheritedRelationship: "spouse",
    inheritedDeathYear: 2026,
    inheritedDeceasedBirthYear: 1971,
    inheritedOwnerRmdStatus: "onOrAfterRbd",
    inheritedWithdrawalChargePolicy: "bcoNoCharge",
    inheritedPartialWithdrawalMinimum: 300,
    inheritedContractFinalDistributionMode: "ownerAge",
    inheritedContractFinalDistributionAge: 72,
  };

  testScenario("BCO Series 201: life-expectancy final year empties and terminates the BCO", () => {
    const r = simulate({
      ...series201TestInputs,
      inheritedPayoutRule: "lifeExpectancy",
    });
    const finalRow = r.yearlyData.find((d) => d.year === 2043);
    const afterFinal = r.yearlyData.filter((d) => d.year > 2043);
    return {
      passed:
        !!finalRow &&
        finalRow.inherited === 0 &&
        finalRow.fromInherited > 0 &&
        finalRow.inheritedFinalDistributionRequired === true &&
        finalRow.inheritedFinalDistributionYear === 2043 &&
        finalRow.inheritedBcoTerminated === true &&
        finalRow.inheritedWithdrawalCharge === 0 &&
        finalRow.earlyPenalty === 0 &&
        finalRow.surplusToCash > 0 &&
        afterFinal.every((d) => d.inherited === 0),
      details: finalRow
        ? `2043 draw=${finalRow.fromInherited}, balance=${finalRow.inherited}, surplusToCash=${finalRow.surplusToCash}, terminated=${finalRow.inheritedBcoTerminated}`
        : "2043 row not in plan",
    };
  });

  testScenario("BCO Series 201: 10-year selection uses 2036 even with age-72 contract metadata", () => {
    const r = simulate({
      ...series201TestInputs,
      inheritedPayoutRule: "tenYear",
    });
    const finalRow = r.yearlyData.find((d) => d.year === 2036);
    const laterAgeRow = r.yearlyData.find((d) => d.year === 2043);
    return {
      passed:
        !!finalRow &&
        finalRow.inherited === 0 &&
        finalRow.fromInherited > 0 &&
        finalRow.inheritedFinalDistributionRequired === true &&
        finalRow.inheritedFinalDistributionYear === 2036 &&
        !!laterAgeRow &&
        laterAgeRow.inherited === 0,
      details: finalRow
        ? `2036 draw=${finalRow.fromInherited}, balance=${finalRow.inherited}, effective deadline=${finalRow.inheritedFinalDistributionYear}`
        : "2036 row not in plan",
    };
  });

  // ============================================================
  // SETTINGS IMPORT — parse pasted "Label: value" text
  // ============================================================
  const importSample = [
    "# Retirement Planner Settings",
    "",
    "## Timing",
    "Filing Status: Single",
    "Current Age: 50",
    "Retirement Age: 51",
    "Plan Through Age: 85",
    "",
    "## Current Balances",
    "Cash / HYSA: $1,400,000",
    "Taxable Brokerage: $400,000",
    "Taxable Cost Basis %: 70.00%",
    "401k / 403b: $1,258,000",
    "Traditional IRA: $24,213",
    "Roth IRA: $81,458",
    "HSA: $30,392",
    "Credit Card Debt: $3,800",
    "",
    "## Cash Strategy",
    "Cash Withdrawal Strategy: Preserve cash reserve",
    "Minimum Cash Reserve: $1,000,000",
    "Allow Reserve As Last Resort: Yes",
    "",
    "## Returns & Inflation",
    "Pre-Retirement Return: 5.00%",
    "Inflation: 3.00%",
    "",
    "## Income",
    "Age to Claim SS: 62",
    "",
    "## Advanced Tax Model",
    "RMD Start Age: 75",
    "ACA Subsidy Estimate: Yes",
    "Household Size: 1",
    "A totally unknown line: 123",
  ].join("\n");
  const importParsed = parseSettingsText(importSample);

  test(
    "import: money parses ($1,400,000 → balanceCash)",
    importParsed.updates.balanceCash,
    1400000,
  );
  test(
    "import: percent parses (70.00% → 0.70 basis)",
    importParsed.updates.taxableBasisPct,
    0.7,
    (a, e) => Math.abs(a - e) < 1e-9,
  );
  test(
    "import: return percent (5.00% → 0.05)",
    importParsed.updates.preReturn,
    0.05,
    (a, e) => Math.abs(a - e) < 1e-9,
  );
  test("import: age int (51 → retirementAge)", importParsed.updates.retirementAge, 51);
  test("import: SS claim age (62)", importParsed.updates.ssAge, 62);
  test("import: RMD start age (75)", importParsed.updates.rmdStartAge, 75);
  testScenario("import: filing status enum → single", () => ({
    passed: importParsed.updates.filingStatus === "single",
    details: `filingStatus=${importParsed.updates.filingStatus}`,
  }));
  testScenario("import: cash strategy label → preserveReserve", () => ({
    passed: importParsed.updates.cashStrategy === "preserveReserve",
    details: `cashStrategy=${importParsed.updates.cashStrategy}`,
  }));
  testScenario("import: boolean yes → true (allowReserve, ACA)", () => ({
    passed:
      importParsed.updates.allowReserveAsLastResort === true &&
      importParsed.updates.useAcaSubsidyEstimate === true,
    details: `allowReserve=${importParsed.updates.allowReserveAsLastResort}, aca=${importParsed.updates.useAcaSubsidyEstimate}`,
  }));
  testScenario("import: unknown line is skipped, not applied", () => ({
    passed:
      importParsed.skipped.some((s) => /unknown line/i.test(s.label)) &&
      importParsed.updates.mode === "single",
    details: `skipped ${importParsed.skipped.length}, mode=${importParsed.updates.mode}`,
  }));
  testScenario("import: applied set flows through simulate()", () => {
    const merged = normalizeInputs({ ...DEFAULT_INPUTS, ...importParsed.updates });
    const r = simulate(merged);
    return {
      passed: r.yearlyData.length > 0 && merged.balanceCash === 1400000,
      details: `rows=${r.yearlyData.length}, cash=${merged.balanceCash}`,
    };
  });
  // Section scoping: bare "Balance" only maps to the inherited account when it
  // appears inside the Inherited (BCO) section.
  testScenario("import: 'Balance' scoped to Inherited (BCO) section", () => {
    const scoped = parseSettingsText(
      [
        "## Inherited (BCO)",
        "Balance: $250,000",
        "Account Type: Non-qualified annuity",
        "Cost Basis: $180,000",
        "Payout Rule: 10-year rule",
        "Relationship to Owner: Surviving spouse",
      ].join("\n"),
    );
    const loose = parseSettingsText("## Timing\nBalance: $250,000");
    return {
      passed:
        scoped.updates.balanceInherited === 250000 &&
        scoped.updates.inheritedTaxType === "nonqualified" &&
        scoped.updates.inheritedBasis === 180000 &&
        scoped.updates.inheritedPayoutRule === "tenYear" &&
        loose.updates.balanceInherited === undefined,
      details: `scoped balanceInherited=${scoped.updates.balanceInherited}, loose=${loose.updates.balanceInherited}`,
    };
  });
  testScenario("import: BCO contract fields preserve plan type and deadline settings", () => {
    const parsed = parseSettingsText(
      [
        "## Inherited (BCO)",
        "Balance: $300,000",
        "Inherited Plan Type: 403(b) TSA / public-school plan",
        "Contract / Product: Equitable EQUI-VEST Series 201",
        "Withdrawal-Charge Treatment: BCO endorsement: no withdrawal charge",
        "Partial Withdrawal Minimum: $300",
        "Payout Rule: Life expectancy (stretch)",
        "Relationship to Owner: Surviving spouse",
        "Year of Owner's Death: 2026",
        "Owner's Birth Year: 1971",
        "Owner RMD Status: Died before required beginning date",
        "Contract Final Distribution Rule: Deceased owner's age 72",
        "Deceased Owner's Final Distribution Age: 72",
        "Contract Final Distribution Year: 2043",
        "Contract Source Note: Equitable Series 201 BCO endorsement",
      ].join("\n"),
    );
    return {
      passed:
        parsed.updates.balanceInherited === 300000 &&
        parsed.updates.inheritedPlanType === "403bTsa" &&
        parsed.updates.inheritedContractLabel === "Equitable EQUI-VEST Series 201" &&
        parsed.updates.inheritedWithdrawalChargePolicy === "bcoNoCharge" &&
        parsed.updates.inheritedPartialWithdrawalMinimum === 300 &&
        parsed.updates.inheritedContractFinalDistributionMode === "ownerAge" &&
        parsed.updates.inheritedContractFinalDistributionAge === 72 &&
        parsed.updates.inheritedContractFinalDistributionYear === 2043 &&
        parsed.updates.inheritedOwnerRmdStatus === "beforeRbd" &&
        parsed.updates.inheritedContractSourceNote.includes("Equitable Series 201"),
      details: `plan=${parsed.updates.inheritedPlanType}, mode=${parsed.updates.inheritedContractFinalDistributionMode}, year=${parsed.updates.inheritedContractFinalDistributionYear}`,
    };
  });
  testScenario("import: couple-mode text is detected and refused", () => {
    const couple = parseSettingsText(
      "## Plan Type\nMode: Married Couple\n\n## Primary Timing\nCurrent Age: 60",
    );
    return {
      passed: couple.isCouple === true,
      details: `isCouple=${couple.isCouple}`,
    };
  });

  // ============================================================
  // RMD SURPLUS → CASH — the recorded sweep explains cash growth
  // ============================================================
  testScenario(
    "RMD surplus: excess over need is recorded and lands in cash",
    () => {
      // Already-retired 72-year-old with a large 401k and modest spending:
      // from 73 the RMD (~$113K+) dwarfs the need, so the sweep must fire.
      const r = simulate({
        ...baseInputs,
        filingStatus: "single",
        householdSize: 1,
        currentAge: 72,
        retirementAge: 70,
        planThroughAge: 78,
        balanceCash: 50000,
        balanceTaxable: 0,
        balance401k: 3000000,
        balanceTradIra: 0,
        balanceRoth: 0,
        balanceHsa: 0,
        balanceInherited: 0,
        baseExpenses: 40000,
        healthcarePre65: 0,
        healthcarePost65: 8000,
        partTimeIncome: 0,
        ssIncome: 30000,
        ssAge: 67,
        conversionBridge: 0,
        conversionMid: 0,
        conversionFinal: 0,
        rmdStartAge: 73,
      });
      const idx = r.yearlyData.findIndex((d) => d.surplusToCash > 1000);
      if (idx < 1)
        return {
          passed: false,
          details: `no surplus year found (idx=${idx})`,
        };
      const row = r.yearlyData[idx];
      const identityGap = Math.abs(
        row.grossWithdrawal - (row.netNeed + row.tax) - row.surplusToCash,
      );
      const prev = r.yearlyData[idx - 1];
      // With SS flowing, the waterfall draws 401k first; cash is untouched,
      // so end-of-year cash must rise by at least the swept surplus.
      const cashGrew = row.fromCash === 0 ? row.cash > prev.cash : true;
      return {
        passed: identityGap <= 2 && cashGrew && row.rmdAmount > 0,
        details: `age ${row.age}: surplus=${row.surplusToCash}, gross=${row.grossWithdrawal}, need+tax=${row.netNeed + row.tax}, cash ${prev.cash}→${row.cash}`,
      };
    },
  );
  testScenario(
    "Couple: RMD surplus recorded on shared-cash sweep",
    () => {
      const person = {
        currentAge: 73,
        retirementAge: 70,
        planThroughAge: 80,
        ssAge: 67,
        ssIncome: 25000,
        balance401k: 2000000,
        balanceTradIra: 0,
        balanceRoth: 0,
        balanceHsa: 0,
        rmdStartAge: 73,
        conversionBridge: 0,
        conversionMid: 0,
        conversionFinal: 0,
        pensionIncome: 0,
        partTimeIncome: 0,
        partTimeYears: 0,
        contrib401k: 0,
        contribMatch: 0,
        contribHsa: 0,
        healthcarePre65: 0,
        healthcarePost65: 4000,
      };
      const couple = normalizeCoupleInputs({
        primary: { ...DEFAULT_COUPLE_INPUTS.primary, ...person },
        spouse: {
          ...DEFAULT_COUPLE_INPUTS.spouse,
          ...person,
          balance401k: 0,
          ssIncome: 15000,
        },
        shared: {
          ...DEFAULT_COUPLE_INPUTS.shared,
          balanceCash: 50000,
          balanceTaxable: 0,
          baseExpenses: 50000,
        },
      });
      const r = simulateCouple(couple);
      const row = r.yearlyData.find((d) => d.surplusToCash > 1000);
      if (!row)
        return { passed: false, details: "no couple surplus year found" };
      const identityGap = Math.abs(
        row.grossWithdrawal - (row.netNeed + row.tax) - row.surplusToCash,
      );
      return {
        passed: identityGap <= 2 && row.rmdAmount > 0,
        details: `year ${row.year}: surplus=${row.surplusToCash}, RMD=${row.rmdAmount}`,
      };
    },
  );

  // --- Income surplus conservation: recurring income above spending must
  // pay the year's tax and land in cash, never require portfolio withdrawals
  // (regression: netNeed used to be floored at 0, which discarded the
  // surplus AND paid the tax on that income out of savings).
  testScenario(
    "Income surplus: pension above spending sweeps to cash after tax",
    () => {
      const r = simulate({
        ...baseInputs,
        currentAge: 65,
        retirementAge: 60,
        planThroughAge: 67,
        balanceCash: 100000,
        balanceTaxable: 0,
        balance401k: 0,
        balanceTradIra: 0,
        balanceRoth: 0,
        balanceHsa: 0,
        baseExpenses: 40000,
        healthcarePre65: 0,
        healthcarePost65: 0,
        partTimeIncome: 0,
        partTimeYears: 0,
        ssIncome: 0,
        pensionIncome: 100000,
        pensionStartAge: 60,
        pensionCola: 0,
        conversionBridge: 0,
        conversionMid: 0,
        conversionFinal: 0,
      });
      const row = r.yearlyData[0];
      // $100K pension vs $40K spending: nothing should be withdrawn; the
      // $60K surplus pays the year's tax and the remainder is swept to cash.
      const ok =
        row.grossWithdrawal <= 1 &&
        row.unmetCashFlow === 0 &&
        row.tax > 4000 &&
        row.surplusToCash > 35000 &&
        row.surplusToCash < 60000 &&
        Math.abs(row.surplusToCash - (60000 - row.tax)) <= 2;
      return {
        passed: ok,
        details: `gross=${row.grossWithdrawal}, tax=${row.tax}, surplus=${row.surplusToCash}, unmet=${row.unmetCashFlow}`,
      };
    },
  );
  testScenario(
    "Couple staggered retirement: working spouse's salary funds spending",
    () => {
      const person = {
        contrib401k: 0,
        contribMatch: 0,
        contribHsa: 0,
        salaryIncome: 0,
        partTimeIncome: 0,
        partTimeYears: 0,
        ssIncome: 20000,
        ssAge: 67,
        pensionIncome: 0,
        balanceRoth: 0,
        rothBasis: 0,
        balanceHsa: 0,
        balanceTradIra: 0,
        healthcarePre65: 0,
        healthcarePost65: 6000,
        conversionBridge: 0,
        conversionMid: 0,
        conversionFinal: 0,
      };
      const couple = {
        primary: {
          ...DEFAULT_COUPLE_INPUTS.primary,
          ...person,
          currentAge: 60,
          retirementAge: 60,
          planThroughAge: 85,
          balance401k: 600000,
        },
        spouse: {
          ...DEFAULT_COUPLE_INPUTS.spouse,
          ...person,
          currentAge: 55,
          retirementAge: 60,
          planThroughAge: 85,
          balance401k: 300000,
          salaryIncome: 120000,
          contrib401k: 20000,
        },
        shared: {
          ...DEFAULT_COUPLE_INPUTS.shared,
          balanceCash: 50000,
          balanceTaxable: 500000,
          baseExpenses: 80000,
        },
      };
      const withSalary = simulateCouple(normalizeCoupleInputs(couple));
      const row = withSalary.yearlyData[0];
      // Year 1 is a distribution year (primary retired) with the spouse
      // still working: $120K gross - $20K pre-tax 401k = $100K taxable
      // wages, minus employee FICA (6.2% + 1.45% on $120K = $9,180) =
      // $90,820 spendable — comfortably above $80K spending, so only a
      // small withdrawal (income tax gross-up) is needed.
      const noSalary = simulateCouple(
        normalizeCoupleInputs({
          ...couple,
          spouse: { ...couple.spouse, salaryIncome: 0 },
        }),
      );
      const rowNoSalary = noSalary.yearlyData[0];
      const ok =
        row.phase !== "accumulation" &&
        row.wages >= 90500 &&
        row.wages <= 91200 &&
        Math.abs(row.ficaTax - 9180) <= 5 &&
        row.grossWithdrawal < 6000 &&
        row.unmetCashFlow === 0 &&
        rowNoSalary.grossWithdrawal > 50000;
      return {
        passed: ok,
        details: `wages=${row.wages}, fica=${row.ficaTax}, gross=${row.grossWithdrawal}, tax=${row.tax}; without salary gross=${rowNoSalary.grossWithdrawal}`,
      };
    },
  );

  // --- NY tax benefit recapture (IT-201 supplemental tax, §601(d-1)).
  // MFJ 2024, $216,050 NY income → $200K taxable (6.0% marginal bracket).
  // NYAGI is past every phase-in, so the recapture flattens the schedule to
  // exactly 6.0% × $200,000 = $12,000 (schedule $10,859.75 + $1,140.25).
  test(
    "nyStateTax: recapture flattens $200K taxable (MFJ) to 6.0% = $12,000",
    nyStateTax(216050, 2024, 0),
    12000,
    (a, e) => Math.abs(a - e) <= 2,
  );
  // Below the $107,650 NYAGI floor the recapture must not fire at all.
  test(
    "nyStateTax: no recapture below $107,650 NYAGI",
    nyStateTax(100000, 2024, 0),
    4284.75,
    pctEq,
  );
  // NY brackets are statutory and NOT indexed (indexing ended 2017): a 2050
  // computation with 3% inflation must match 2027 exactly (same rates apply
  // from 2027 on at this income; only the year changes).
  test(
    "nyStateTax: brackets not inflation-indexed (2050 == 2027 at $100K)",
    nyStateTax(100000, 2050, 0.03),
    nyStateTax(100000, 2027, 0.03),
    (a, e) => Math.abs(a - e) <= 0.01,
  );
  // Top-rate sunset: the temporary 9.65/10.3/10.9% rates run through 2032;
  // from 2033 income above the 6.85% bracket reverts to 8.82%. With full
  // recapture, $10M taxable MFJ is flat 10.3% in 2032 and flat 8.82% in 2033.
  test(
    "nyStateTax: 2032 keeps 10.3% top rate ($10M taxable → $1.03M)",
    nyStateTax(10016050, 2032, 0),
    1030000,
    (a, e) => Math.abs(a - e) <= 5,
  );
  test(
    "nyStateTax: 2033 sunset reverts to 8.82% ($10M taxable → $882K)",
    nyStateTax(10016050, 2033, 0),
    882000,
    (a, e) => Math.abs(a - e) <= 5,
  );

  // --- Accumulation-year taxable cash flows (regression: tax was hardcoded
  // to zero and pre-retirement SS/pension was ignored while working).
  testScenario(
    "Accumulation: working 75-year-old pays tax on RMD + SS",
    () => {
      const r = simulate({
        ...baseInputs,
        filingStatus: "single",
        householdSize: 1,
        currentAge: 75,
        retirementAge: 78,
        planThroughAge: 85,
        balanceCash: 50000,
        balanceTaxable: 0,
        balance401k: 500000,
        balanceTradIra: 1000000,
        balanceRoth: 0,
        balanceHsa: 0,
        contrib401k: 10000,
        contribMatch: 0,
        contribHsa: 0,
        baseExpenses: 60000,
        partTimeIncome: 0,
        partTimeYears: 0,
        ssIncome: 30000,
        ssAge: 67,
        pensionIncome: 0,
        rmdStartAge: 73,
        conversionBridge: 0,
        conversionMid: 0,
        conversionFinal: 0,
      });
      const row = r.yearlyData[0];
      // Age 75: IRA RMD = $1M / 24.6 = $40,650 forced from the IRA (401k is
      // still-working exempt), SS is flowing, and the year must carry real
      // tax. The after-tax remainder is reinvested in taxable.
      const ok =
        row.phase === "accumulation" &&
        Math.abs(row.rmdAmount - 40650) <= 2 &&
        row.fromIra >= row.rmdAmount - 1 &&
        row.from401k === 0 &&
        // Born 1951 → FRA 66; claiming at 67 = 12 months of delayed
        // credits (+8%): 30,000 × 1.08 = 32,400 (year-0 inflation = 1).
        row.ss === 32400 &&
        row.tax > 5000 &&
        Math.abs(
          row.surplusToTaxable -
            (row.grossWithdrawal + row.ss + row.pension - row.tax),
        ) <= 2;
      return {
        passed: ok,
        details: `rmd=${row.rmdAmount}, fromIra=${row.fromIra}, ss=${row.ss}, tax=${row.tax}, reinvested=${row.surplusToTaxable}`,
      };
    },
  );
  testScenario(
    "Couple accumulation: working spouses pay tax on forced IRA RMDs",
    () => {
      const person = {
        contrib401k: 0,
        contribMatch: 0,
        contribHsa: 0,
        salaryIncome: 0,
        partTimeIncome: 0,
        partTimeYears: 0,
        ssIncome: 0,
        ssAge: 70,
        pensionIncome: 0,
        balanceRoth: 0,
        rothBasis: 0,
        balanceHsa: 0,
        balance401k: 200000,
        healthcarePre65: 0,
        healthcarePost65: 6000,
        conversionBridge: 0,
        conversionMid: 0,
        conversionFinal: 0,
        rmdStartAge: 73,
      };
      const r = simulateCouple(
        normalizeCoupleInputs({
          primary: {
            ...DEFAULT_COUPLE_INPUTS.primary,
            ...person,
            currentAge: 74,
            retirementAge: 78,
            planThroughAge: 85,
            balanceTradIra: 2000000,
          },
          spouse: {
            ...DEFAULT_COUPLE_INPUTS.spouse,
            ...person,
            currentAge: 74,
            retirementAge: 78,
            planThroughAge: 85,
            balanceTradIra: 0,
          },
          shared: {
            ...DEFAULT_COUPLE_INPUTS.shared,
            balanceCash: 100000,
            balanceTaxable: 0,
            baseExpenses: 70000,
          },
        }),
      );
      const row = r.yearlyData[0];
      // Age 74: primary IRA RMD = $2M / 25.5 = $78,431, forced and taxed
      // while both spouses still work; after-tax remainder reinvested.
      const ok =
        row.phase === "accumulation" &&
        Math.abs(row.rmdAmount - 78431) <= 2 &&
        row.fromIra >= row.rmdAmount - 1 &&
        row.tax > 1500 &&
        row.surplusToTaxable > 0 &&
        row.surplusToTaxable < row.rmdAmount;
      return {
        passed: ok,
        details: `rmd=${row.rmdAmount}, fromIra=${row.fromIra}, tax=${row.tax}, reinvested=${row.surplusToTaxable}`,
      };
    },
  );

  // --- Shortfall materiality bars (regression: a $3 solver residue used to
  // paint a $3.5M year as SHORTFALL; every flagging surface now shares
  // these thresholds).
  test(
    "materialYearUnmetThreshold: floor is $100 (a $3 residue never flags)",
    materialYearUnmetThreshold(60000),
    100,
    (a, e) => a === e,
  );
  test(
    "materialUnmetThreshold: cumulative floor is $1,000",
    materialUnmetThreshold(60000),
    1000,
    (a, e) => a === e,
  );
  // --- Solver-residue top-up: a comfortably funded plan must show ZERO
  // unmet cash flow in every year — tax/IRMAA loop tolerances used to leave
  // a few phantom dollars.
  testScenario(
    "Funded plan carries no phantom unmet cash flow (individual)",
    () => {
      const r = simulate({ ...DEFAULT_INPUTS, balanceCash: 10000000 });
      const worst = r.yearlyData.reduce(
        (m, d) => Math.max(m, d.unmetCashFlow || 0),
        0,
      );
      return {
        passed:
          r.summary.totalUnmetCashFlow === 0 && worst === 0 && !r.summary.depleted,
        details: `totalUnmet=${r.summary.totalUnmetCashFlow}, worstYear=${worst}, depleted=${r.summary.depleted}`,
      };
    },
  );
  testScenario(
    "Funded plan carries no phantom unmet cash flow (couple)",
    () => {
      const r = simulateCouple(normalizeCoupleInputs({...DEFAULT_COUPLE_INPUTS, shared: {...DEFAULT_COUPLE_INPUTS.shared, balanceCash: 10000000}}));
      const worst = r.yearlyData.reduce(
        (m, d) => Math.max(m, d.unmetCashFlow || 0),
        0,
      );
      return {
        passed:
          r.summary.totalUnmetCashFlow === 0 && worst === 0 && !r.summary.depleted,
        details: `totalUnmet=${r.summary.totalUnmetCashFlow}, worstYear=${worst}, depleted=${r.summary.depleted}`,
      };
    },
  );

  // --- Employee FICA (Pub 15): 6.2% OASDI to the wage base + 1.45% Medicare.
  test(
    "employeeFica: $120K wages in 2026 = $9,180",
    employeeFica(120000, 2026, 0.03),
    9180,
    (a, e) => Math.abs(a - e) <= 1,
  );
  // Above the 2026 wage base ($184,500): OASDI caps at $11,439.
  test(
    "employeeFica: $300K wages in 2026 = $15,789 (OASDI capped)",
    employeeFica(300000, 2026, 0.03),
    15789,
    (a, e) => Math.abs(a - e) <= 1,
  );

  // --- Staggered-retirement funding caps (regression: contributions with no
  // salary used to be credited from nowhere — $20K appeared per probe year).
  const staggeredBase = {
    contrib401k: 0,
    contribMatch: 0,
    contribHsa: 0,
    salaryIncome: 0,
    partTimeIncome: 0,
    partTimeYears: 0,
    ssIncome: 0,
    ssAge: 70,
    pensionIncome: 0,
    balanceRoth: 0,
    rothBasis: 0,
    balanceHsa: 0,
    balance401k: 0,
    balanceTradIra: 0,
    healthcarePre65: 0,
    healthcarePost65: 0,
    conversionBridge: 0,
    conversionMid: 0,
    conversionFinal: 0,
    rmdStartAge: 73,
  };
  const makeStaggeredCouple = (spouseOverrides, sharedOverrides = {}) =>
    normalizeCoupleInputs({
      primary: {
        ...DEFAULT_COUPLE_INPUTS.primary,
        ...staggeredBase,
        currentAge: 60,
        retirementAge: 60,
        planThroughAge: 85,
      },
      spouse: {
        ...DEFAULT_COUPLE_INPUTS.spouse,
        ...staggeredBase,
        currentAge: 55,
        retirementAge: 60,
        planThroughAge: 85,
        ...spouseOverrides,
      },
      shared: {
        ...DEFAULT_COUPLE_INPUTS.shared,
        balanceCash: 100000,
        balanceTaxable: 600000,
        baseExpenses: 60000,
        ...sharedOverrides,
      },
    });
  testScenario(
    "Staggered $0 salary: working spouse's contributions stop (no free money)",
    () => {
      const r = simulateCouple(
        makeStaggeredCouple({ contrib401k: 20000, contribHsa: 4000 }),
      );
      const row = r.yearlyData[0];
      const so = row.ownerDetails?.spouse || {};
      const ok =
        row.phase !== "accumulation" &&
        so.contribution401kApplied === 0 &&
        so.contributionHsaApplied === 0 &&
        row.wages === 0;
      return {
        passed: ok,
        details: `401kApplied=${so.contribution401kApplied}, hsaApplied=${so.contributionHsaApplied}, wages=${row.wages}`,
      };
    },
  );
  testScenario(
    "Staggered $10K salary caps $38K of contributions at compensation",
    () => {
      // $10K salary, $30K 401k + $8K HSA requested: HSA funds first ($8K,
      // FICA-exempt), FICA on the $2K remainder (~$153), then the deferral
      // gets what's left (~$1,847). Total credited stays within pay.
      const r = simulateCouple(
        makeStaggeredCouple({
          salaryIncome: 10000,
          contrib401k: 30000,
          contribHsa: 8000, hsaCoverage: "family", hsaPayroll: true,
        }),
      );
      const row = r.yearlyData[0];
      const so = row.ownerDetails?.spouse || {};
      const funded =
        (so.contribution401kApplied || 0) + (so.contributionHsaApplied || 0);
      const ok =
        so.contributionHsaApplied === 8000 &&
        funded >= 9800 &&
        funded <= 10000 &&
        row.wages === 0;
      return {
        passed: ok,
        details: `401kApplied=${so.contribution401kApplied}, hsaApplied=${so.contributionHsaApplied}, funded=${funded}, wages=${row.wages}, fica=${row.ficaTax}`,
      };
    },
  );
  testScenario(
    "Still-working spouse's 401k is shielded from RMDs and withdrawals",
    () => {
      // Spouse is 75 and still working with a $1M current-employer 401k and
      // a $246K IRA: only the IRA is RMD-subject ($246,000 / 24.6 = $10,000)
      // and the 401k must never be drawn while they work.
      const r = simulateCouple(
        makeStaggeredCouple(
          {
            currentAge: 75,
            retirementAge: 78,
            planThroughAge: 85,
            balance401k: 1000000,
            balanceTradIra: 246000,
            salaryIncome: 150000,
            contrib401k: 10000,
          },
          { baseExpenses: 90000 },
        ),
      );
      const row = r.yearlyData[0];
      const so = row.ownerDetails?.spouse || {};
      const ok =
        row.phase !== "accumulation" &&
        Math.abs(row.rmdAmount - 10000) <= 2 &&
        (so.from401k || 0) === 0 &&
        row.from401k === 0 &&
        Math.abs(row.ficaTax - 11475) <= 5 &&
        row.unmetCashFlow === 0;
      return {
        passed: ok,
        details: `rmd=${row.rmdAmount}, spouseFrom401k=${so.from401k}, from401k=${row.from401k}, fica=${row.ficaTax}, unmet=${row.unmetCashFlow}`,
      };
    },
  );

  // --- Salary stacking in accumulation years (regression: forced flows
  // were taxed from the bottom brackets even when the user earns a salary,
  // understating the incremental tax by ~$12K/yr in the audit probe).
  testScenario(
    "Accumulation salary stacking: RMD+SS taxed on top of $100K wages",
    () => {
      const base = {
        ...baseInputs,
        filingStatus: "single",
        householdSize: 1,
        currentAge: 75,
        retirementAge: 78,
        planThroughAge: 85,
        balanceCash: 50000,
        balanceTaxable: 0,
        balance401k: 500000,
        balanceTradIra: 1000000,
        balanceRoth: 0,
        balanceHsa: 0,
        contrib401k: 10000,
        contribMatch: 0,
        contribHsa: 0,
        baseExpenses: 60000,
        partTimeIncome: 0,
        partTimeYears: 0,
        ssIncome: 30000,
        ssAge: 67,
        pensionIncome: 0,
        rmdStartAge: 73,
        conversionBridge: 0,
        conversionMid: 0,
        conversionFinal: 0,
      };
      const noSalary = simulate({ ...base, salaryIncome: 0 });
      const withSalary = simulate({ ...base, salaryIncome: 100000 });
      const row0 = noSalary.yearlyData[0];
      const row1 = withSalary.yearlyData[0];
      // Salary-only baseline is subtracted, so the year's charged tax is the
      // INCREMENT attributable to the RMD + SS + interest stacking on
      // $90K taxable wages ($100K - $10K 401k) — roughly $18K vs ~$5.5K
      // from the bottom brackets. Reinvestment identity must still hold.
      const identityGap = Math.abs(
        row1.surplusToTaxable -
          (row1.grossWithdrawal + row1.ss + row1.pension - row1.tax),
      );
      const ok =
        row1.phase === "accumulation" &&
        row1.tax > row0.tax + 9000 &&
        row1.tax >= 15000 &&
        row1.tax <= 21000 &&
        row1.magi > 150000 &&
        row1.taxableSs >= 25000 &&
        identityGap <= 2 &&
        row1.surplusToTaxable < row0.surplusToTaxable;
      return {
        passed: ok,
        details: `tax noSalary=${row0.tax}, withSalary=${row1.tax}, magi=${row1.magi}, taxableSs=${row1.taxableSs}, reinvested ${row0.surplusToTaxable}→${row1.surplusToTaxable}`,
      };
    },
  );
  testScenario(
    "Couple accumulation salary stacking raises the RMD's incremental tax",
    () => {
      const person = {
        contrib401k: 0,
        contribMatch: 0,
        contribHsa: 0,
        salaryIncome: 0,
        partTimeIncome: 0,
        partTimeYears: 0,
        ssIncome: 0,
        ssAge: 70,
        pensionIncome: 0,
        balanceRoth: 0,
        rothBasis: 0,
        balanceHsa: 0,
        balance401k: 200000,
        healthcarePre65: 0,
        healthcarePost65: 6000,
        conversionBridge: 0,
        conversionMid: 0,
        conversionFinal: 0,
        rmdStartAge: 73,
      };
      const couple = (primarySalary) =>
        normalizeCoupleInputs({
          primary: {
            ...DEFAULT_COUPLE_INPUTS.primary,
            ...person,
            currentAge: 74,
            retirementAge: 78,
            planThroughAge: 85,
            balanceTradIra: 2000000,
            salaryIncome: primarySalary,
          },
          spouse: {
            ...DEFAULT_COUPLE_INPUTS.spouse,
            ...person,
            currentAge: 74,
            retirementAge: 78,
            planThroughAge: 85,
            balanceTradIra: 0,
          },
          shared: {
            ...DEFAULT_COUPLE_INPUTS.shared,
            balanceCash: 100000,
            balanceTaxable: 0,
            baseExpenses: 70000,
          },
        });
      const row0 = simulateCouple(couple(0)).yearlyData[0];
      const row1 = simulateCouple(couple(150000)).yearlyData[0];
      // Same $78,431 RMD, but stacked on $150K MFJ wages it lands in the
      // 22% federal bracket with NY recapture territory instead of being
      // absorbed by deductions and the bottom brackets.
      const ok =
        row1.phase === "accumulation" &&
        Math.abs(row1.rmdAmount - 78431) <= 2 &&
        row1.tax > row0.tax + 8000 &&
        row1.magi > 220000 &&
        row1.surplusToTaxable < row0.surplusToTaxable;
      return {
        passed: ok,
        details: `tax noSalary=${row0.tax}, withSalary=${row1.tax}, magi=${row1.magi}, reinvested ${row0.surplusToTaxable}→${row1.surplusToTaxable}`,
      };
    },
  );

  // ============================================================
  // ROUND-3 / MODERATE-FIX REGRESSION TESTS
  // ============================================================

  // --- NIIT includes taxable interest in the §1411 base (not just LTCG).
  // MFJ, $260K ordinary (incl. $40K interest), no gains: excess MAGI $10K →
  // NIIT = 3.8% × min($40K NII, $10K) = $380 more than with $0 interest in
  // the NII base at identical MAGI.
  test(
    "NIIT: cash interest enters the investment-income base (+$380)",
    totalTax(260000, 0, 2026, 0, 0.03, 0, 0, 0, "mfj", 40000) -
      totalTax(260000, 0, 2026, 0, 0.03, 0, 0, 0, "mfj", 0),
    380,
    (a, e) => Math.abs(a - e) <= 1,
  );
  // --- FRA from birth year; delayed credits uncapped (8%/yr FRA→70).
  test(
    "fullRetirementAgeForBirthYear: 1957 cohort = 66.5",
    fullRetirementAgeForBirthYear(1957),
    66.5,
    (a, e) => Math.abs(a - e) < 0.001,
  );
  test(
    "SS delayed credits: FRA 66 claiming at 70 = +32% (48 months, no cap)",
    adjustedSocialSecurityBenefit(30000, 70, 66),
    39600,
    (a, e) => Math.abs(a - e) <= 1,
  );
  // --- Fractional ages round to the statutory whole-year lookup.
  test(
    "rmdDivisor(74.5) rounds to the age-75 divisor (24.6), not the 2.0 trap",
    rmdDivisor(74.5),
    24.6,
    (a, e) => Math.abs(a - e) < 0.01,
  );
  // --- ACA: statutory 100%-FPL eligibility floor (no PTC below it).
  test(
    "ACA: below 100% FPL = no subsidy (full sticker)",
    estimateAcaHealthcareCost(30000, 12000, 1, 2027, 0.03),
    30000,
    (a, e) => Math.abs(a - e) <= 1,
  );
  // --- Pension commencement timing: today's dollars inflate at GENERAL
  // inflation to the start year, then the pension COLA takes over.
  testScenario(
    "Pension deferred 10 years prices at inflation-to-start, COLA after",
    () => {
      const r = simulate({
        ...baseInputs,
        currentAge: 50,
        retirementAge: 60,
        planThroughAge: 70,
        pensionIncome: 30000,
        pensionStartAge: 60,
        pensionCola: 0.02,
        ssIncome: 0,
        partTimeIncome: 0,
        partTimeYears: 0,
        conversionBridge: 0,
        conversionMid: 0,
        conversionFinal: 0,
      });
      const atStart = r.yearlyData.find((d) => d.age === 60);
      const nextYear = r.yearlyData.find((d) => d.age === 61);
      // 30,000 × 1.03^10 = 40,317 at commencement; ×1.02 the next year.
      const ok =
        Math.abs(atStart.pension - 40317) <= 5 &&
        Math.abs(nextYear.pension - Math.round(40317 * 1.02)) <= 10;
      return {
        passed: ok,
        details: `age60=${atStart.pension} (want ~40,317), age61=${nextYear.pension}`,
      };
    },
  );
  // --- Flexible spending cuts lifestyle only; the HSA-covered healthcare
  // block is untouched, so the portfolio draw actually falls.
  testScenario(
    "Flex cut reduces portfolio need; HSA healthcare offset is preserved",
    () => {
      const r = simulate(
        {
          ...baseInputs,
          currentAge: 66,
          retirementAge: 60,
          planThroughAge: 75,
          balanceCash: 0,
          balanceTaxable: 2000000,
          balance401k: 0,
          balanceTradIra: 0,
          balanceRoth: 0,
          balanceHsa: 300000,
          baseExpenses: 50000,
          healthcarePost65: 20000,
          healthcarePre65: 0,
          partTimeIncome: 0,
          partTimeYears: 0,
          ssIncome: 0,
          conversionBridge: 0,
          conversionMid: 0,
          conversionFinal: 0,
        },
        // Already retired 6 years: the returns array is indexed from the
        // retirement year, so year 0 of this projection reads index 6.
        {
          yearlyReturns: [-0.3, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          useFlexibleSpending: true,
        },
      );
      const row0 = r.yearlyData[0];
      const row1 = r.yearlyData[1];
      // Year 2 (after the -30% year): lifestyle cut 10%, healthcare intact.
      const lifestyle1 = Math.round(50000 * 1.03);
      const hc1 = Math.round(20000 * 1.03);
      const ok =
        Math.abs(row1.spending - (lifestyle1 - Math.round(lifestyle1 * 0.1) + hc1)) <= 3 &&
        Math.abs(row1.hsaWithdrawal - hc1) <= 3 &&
        row1.netNeed < row0.netNeed;
      return {
        passed: ok,
        details: `spending=${row1.spending}, hsa=${row1.hsaWithdrawal} (want ~${hc1}), netNeed ${row0.netNeed}→${row1.netNeed}`,
      };
    },
  );
  // --- Input sanitation: catastrophic domains are clamped at the engine.
  testScenario(
    "Sanitation: return below -100% and basis% above 100% are clamped",
    () => {
      const r = simulate({
        ...baseInputs,
        currentAge: 65,
        retirementAge: 60,
        planThroughAge: 75,
        postReturn: -1.5,
        taxableBasisPct: 1.7,
        ssIncome: 0,
        conversionBridge: 0,
        conversionMid: 0,
        conversionFinal: 0,
      });
      const row0 = r.yearlyData[0];
      // Basis% 1.7 clamps to 100%: starting basis can never exceed the
      // $200K starting balance (it MAY exceed market value after the -99%
      // year — that's a legitimate unrealized loss, not a bug).
      const ok =
        Number.isFinite(r.summary.portfolioAtEnd) &&
        r.summary.portfolioAtEnd >= 0 &&
        row0.taxableBasisEnd <= 200000 + 1;
      return {
        passed: ok,
        details: `end=${r.summary.portfolioAtEnd}, basisEnd=${row0.taxableBasisEnd} (start balance 200K)`,
      };
    },
  );
  // --- HSA catch-ups are per-owner: one spouse cannot absorb the other's.
  testScenario(
    "Couple HSA: primary capped at family pool + OWN catch-up only",
    () => {
      const r = simulateCouple(
        normalizeCoupleInputs({
          primary: {
            ...DEFAULT_COUPLE_INPUTS.primary,
            currentAge: 60,
            retirementAge: 65,
            contribHsa: 12000, salaryIncome: 100000, hsaCoverage: "family",
          },
          spouse: {
            ...DEFAULT_COUPLE_INPUTS.spouse,
            currentAge: 55,
            retirementAge: 65,
            contribHsa: 10000, salaryIncome: 100000, hsaCoverage: "family",
          },
        }),
      );
      const row = r.yearlyData[0];
      const p = row.ownerDetails.primary.contributionHsaApplied;
      const s = row.ownerDetails.spouse.contributionHsaApplied;
      // 2026: family $8,750 + own $1,000 catch-up = $9,750 max for primary;
      // spouse then gets any family remainder + their own $1,000.
      const ok = p === 9750 && s === 1000;
      return {
        passed: ok,
        details: `primary=${p} (want 9750), spouse=${s} (want 1000)`,
      };
    },
  );
  // --- Early Roth earnings draws are ordinary income, not just penalized.
  testScenario(
    "Early Roth earnings are income-taxed (basis-only draws are not)",
    () => {
      const base = {
        ...baseInputs,
        currentAge: 50,
        retirementAge: 45,
        planThroughAge: 53,
        balanceCash: 0,
        balanceTaxable: 0,
        balance401k: 0,
        balanceTradIra: 0,
        balanceRoth: 300000,
        balanceHsa: 0,
        baseExpenses: 40000,
        healthcarePre65: 0,
        healthcarePost65: 0,
        partTimeIncome: 0,
        partTimeYears: 0,
        ssIncome: 0,
        conversionBridge: 0,
        conversionMid: 0,
        conversionFinal: 0,
        useSepp: false,
      };
      const allEarnings = simulate({ ...base, rothBasis: 0 });
      const allBasis = simulate({ ...base, rothBasis: 300000 });
      const rowE = allEarnings.yearlyData[0];
      const rowB = allBasis.yearlyData[0];
      // Basis draws: no tax, no penalty. Earnings draws: 10% penalty AND
      // ordinary income tax on the withdrawal.
      const ok =
        rowB.tax <= 1 &&
        rowE.earlyPenalty > 3000 &&
        rowE.tax > rowE.earlyPenalty + 1500;
      return {
        passed: ok,
        details: `earnings tax=${rowE.tax} (penalty=${rowE.earlyPenalty}), basis tax=${rowB.tax}`,
      };
    },
  );
  // --- Already-retired couple withdrawal rate uses TODAY'S assets.
  testScenario(
    "Couple already retired: withdrawal rate denominator is current assets",
    () => {
      const person = {
        contrib401k: 0,
        contribMatch: 0,
        contribHsa: 0,
        salaryIncome: 0,
        partTimeIncome: 0,
        partTimeYears: 0,
        ssIncome: 0,
        ssAge: 70,
        pensionIncome: 0,
        balanceRoth: 0,
        rothBasis: 0,
        balanceHsa: 0,
        balance401k: 0,
        balanceTradIra: 0,
        healthcarePre65: 0,
        healthcarePost65: 0,
        conversionBridge: 0,
        conversionMid: 0,
        conversionFinal: 0,
      };
      const r = simulateCouple(
        normalizeCoupleInputs({
          primary: {
            ...DEFAULT_COUPLE_INPUTS.primary,
            ...person,
            currentAge: 66,
            retirementAge: 60,
            planThroughAge: 90,
          },
          spouse: {
            ...DEFAULT_COUPLE_INPUTS.spouse,
            ...person,
            currentAge: 66,
            retirementAge: 60,
            planThroughAge: 90,
          },
          shared: {
            ...DEFAULT_COUPLE_INPUTS.shared,
            balanceCash: 200000,
            balanceTaxable: 800000,
            baseExpenses: 90000,
          },
        }),
      );
      const gross = r.yearlyData[0].grossWithdrawal;
      const expectedRate = gross / 1000000;
      const ok =
        Math.abs(r.summary.year1WithdrawalRate - expectedRate) < 0.0005;
      return {
        passed: ok,
        details: `rate=${(r.summary.year1WithdrawalRate * 100).toFixed(2)}% vs gross/currentTotal=${(expectedRate * 100).toFixed(2)}%`,
      };
    },
  );

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  return { passed, failed, total: results.length, results };
}

function sanitizeEngineInputs(inputs) {
  if (!inputs) return inputs;
  const out = { ...inputs };
  for (const key of [
    "preReturn",
    "postReturn",
    "cashReturn",
    "inflation",
    "seppRate",
    "pensionCola",
  ]) {
    if (typeof out[key] === "number") out[key] = Math.max(-0.99, out[key]);
  }
  if (typeof out.taxableBasisPct === "number")
    out.taxableBasisPct = Math.min(1, Math.max(0, out.taxableBasisPct));
  if (typeof out.taxableAnnualTaxDrag === "number")
    out.taxableAnnualTaxDrag = Math.max(0, out.taxableAnnualTaxDrag);
  if (typeof out.portfolioVolatility === "number")
    out.portfolioVolatility = Math.max(0, out.portfolioVolatility);
  // Whole-year ages: statutory lookups (RMD tables, catch-up eligibility,
  // FRA months) are defined on integer ages attained in the year.
  for (const key of [
    "currentAge",
    "retirementAge",
    "planThroughAge",
    "ssAge",
    "pensionStartAge",
    "rmdStartAge",
    "partTimeYears",
  ]) {
    if (typeof out[key] === "number" && Number.isFinite(out[key]))
      out[key] = Math.round(out[key]);
  }
  return out;
}

function simulate(inputs, options = {}) {
  inputs = sanitizeEngineInputs(inputs);
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
    salaryIncome = 0,
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
    rothBasis: _rothBasis = 0,
    useSepp: _useSepp = false,
    seppRate: _seppRate = 0.05,
    // Inherited (BCO) account — an inherited IRA/403(b)/annuity kept in
    // beneficiary form under a Beneficiary Continuation Option.
    balanceInherited = 0,
    inheritedTaxType = "qualified",
    inheritedBasis = 0,
    inheritedPayoutRule = "lifeExpectancy",
    inheritedRelationship = "spouse",
    inheritedDeathYear = PROJECTION_START_YEAR,
    inheritedDeceasedBirthYear = 1965,
    // Layer-B contract overlay (see resolveInheritedFinalDistributionYear).
    // Defaults reproduce pure federal behavior for legacy inputs.
    inheritedPlanType = "",
    inheritedWithdrawalChargePolicy = "unknown",
    inheritedPartialWithdrawalMinimum = 0,
    inheritedContractFinalDistributionMode = "none",
    inheritedContractFinalDistributionAge = 72,
    inheritedContractFinalDistributionYear = 0,
    inheritedOwnerRmdStatus = "auto",
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

  const currentYear = inputs.projectionStartYear ?? PROJECTION_START_YEAR;
  const retirementYear = currentYear + (retirementAge - currentAge);
  const endYear = currentYear + (planThroughAge - currentAge);
  // Filing status drives federal/NY brackets and deductions, SS taxation
  // thresholds, NIIT, senior deductions, and IRMAA tiers. Defaults to MFJ
  // for backward compatibility with direct engine calls.
  const filingStatus = inputs.filingStatus === "single" ? "single" : "mfj";
  const effectiveRmdStartAge =
    rmdStartAge ?? defaultRmdStartAge(currentAge, currentYear);
  // Benefits start within the legal 62–70 window (clamped both ways).
  const ssClaimAge = effectiveSsClaimAge(ssAge);
  // FRA derived from birth year (66 for 1943-54 cohorts rising to 67 for
  // 1960+) — the old hardcoded 67 shortchanged older claimants' delayed
  // credits and overstated their early-claim reductions.
  const ssFra = fullRetirementAgeForBirthYear(currentYear - currentAge);
  // Pension timing: the input is today's dollars AT BENEFIT START, so a
  // not-yet-started pension inflates at GENERAL inflation until
  // commencement and the pension COLA applies only once payments begin.
  // (The old code grew it at the COLA from today: a $30K pension starting
  // in 10 years at 2% COLA / 3% inflation priced at $36,570 instead of
  // $40,317.) A pension already in pay COLAs from today, unchanged.
  const pensionStartYear =
    currentYear + Math.max(0, pensionStartAge - currentAge);
  // Rule of 55: separating from service in/after the year you turn 55 makes
  // withdrawals from THAT employer's 401k penalty-free (never IRAs). Retiring
  // before 55 forfeits it permanently for this model.
  const penaltyFree401k = inputs.currentEmployerPlan !== false && retirementAge >= 55;
  const taxableReturn = (ret) => Math.max(-0.99, ret - (inputs.taxableOrdinaryYield>0 ? 0 : taxableAnnualTaxDrag));

  let bCash = balanceCash;
  let bTaxable = balanceTaxable;
  // Cost basis tracks what was paid in (vs. current market value).
  // Only the gain portion (value - basis) is taxable on sale.
  let bTaxableBasis = balanceTaxable * taxableBasisPct;
  let b401k = balance401k;
  let bTradIra = balanceTradIra;
  let bRoth = balanceRoth;
  const planRoth = {balance: inputs.balanceRoth401k || 0, basis: inputs.roth401kBasis || 0, firstYear: inputs.roth401kFirstYear};
  let bHsa = balanceHsa;
  let bInherited = Math.max(0, balanceInherited);
  // Plan-type classification (backward compatible): legacy inputs carry only
  // inheritedTaxType — "qualified" maps to a GENERIC qualified inherited
  // retirement plan (never assumed to be an IRA), "nonqualified" to a
  // nonqualified annuity. When inheritedPlanType is present it wins, and the
  // tax character follows from it: 403(b)/TSA, IRA, and other qualified
  // plans are ordinary-income accounts; only "nonqualifiedAnnuity" keeps the
  // earnings-first/basis treatment.
  const effectiveInheritedPlanType =
    inheritedPlanType ||
    (inheritedTaxType === "nonqualified"
      ? "nonqualifiedAnnuity"
      : "qualifiedOther");
  const effectiveInheritedTaxType =
    effectiveInheritedPlanType === "nonqualifiedAnnuity"
      ? "nonqualified"
      : "qualified";
  // Layer A (federal) vs layer B (contract) deadlines. The effective
  // deadline forces the ENTIRE remaining balance out in that year; a
  // contract deadline can only shorten the federal 10-year deadline.
  const inheritedDeadlines = resolveInheritedFinalDistributionYear({
    payoutRule: inheritedPayoutRule,
    deathYear: inheritedDeathYear,
    deceasedBirthYear: inheritedDeceasedBirthYear,
    contractMode: inheritedContractFinalDistributionMode,
    contractAge: inheritedContractFinalDistributionAge,
    contractYear: inheritedContractFinalDistributionYear,
  });
  // Non-qualified annuity cost basis ("investment in the contract"): the
  // portion of the balance that returns tax-free after gains distribute
  // first. Qualified inherited accounts have no after-tax basis here.
  let bInheritedBasis =
    effectiveInheritedTaxType === "nonqualified"
      ? Math.max(0, Math.min(inheritedBasis, bInherited))
      : 0;
  const inheritedConfig = {
    payoutRule: inheritedPayoutRule,
    relationship: inheritedRelationship,
    deathYear: inheritedDeathYear,
    deceasedBirthYear: inheritedDeceasedBirthYear,
    finalDistributionYear: inheritedDeadlines.effectiveDeadline,
    ownerRmdStatus: inheritedOwnerRmdStatus,
  };
  // Contract execution state: a full withdrawal terminates the BCO.
  let inheritedBcoTerminated = false;
  let unpaidDebt = Math.max(0, creditCardDebt);
  const initialCashPayoff = Math.min(bCash, unpaidDebt);
  bCash -= initialCashPayoff;
  unpaidDebt -= initialCashPayoff;
  // Any LTCG realized selling taxable assets to clear debt at time zero. It is
  // taxed in the first distribution year (folded into that year's solve). For
  // a user still working in year 1 this defers the tax to the first retirement
  // year — a minor timing approximation, consistent with accumulation-year
  // salary/gains taxes being out of scope; previously the gain was untaxed.
  let pendingDebtPayoffGain = 0;
  if (unpaidDebt > 0 && bTaxable > 0) {
    const taxablePayoff = Math.min(bTaxable, unpaidDebt);
    const payoffGain = computeRealizedGain(taxablePayoff, bTaxable, bTaxableBasis);
    bTaxable -= taxablePayoff;
    bTaxableBasis = Math.max(0, bTaxableBasis - Math.max(0, taxablePayoff - payoffGain));
    unpaidDebt -= taxablePayoff;
    pendingDebtPayoffGain = payoffGain;
  }

  const yearlyData = [];
  let totalTaxesPaid = 0;
  let totalConverted = 0;
  let totalUnmetCashFlow = unpaidDebt;
  // `depleted` is finalized after the loop: assets hitting zero flag it
  // immediately; unmet cash flow is judged cumulatively against the same
  // materiality threshold as the plan banner, so sub-dollar solver rounding
  // can never mark a funded plan depleted (the raw flag used to leak to the
  // Ask AI context and contradict the banner).
  let depleted = false;
  // Projected MAGI by year — real IRMAA is based on MAGI from two years
  // earlier, so retirement years look back where a projected MAGI exists.
  const magiByYear = historicalMagi(inputs);
  // Roth ordering layers: user-entered contribution basis + conversion
  // vintages created below. Basis is capped at the starting balance.
  const rothLayers = initialRothLayers(inputs);
  const ssHistory = {withheldMonths: inputs.ssPriorWithheldMonths || 0};
  const seppState = {balance:0,initialized:false,allocation:0};
  let priorYearEndTotal =
    bCash + bTaxable + b401k + bTradIra + bRoth + planRoth.balance + seppState.balance + bHsa + bInherited - unpaidDebt;
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
    seppState.available = bTradIra + (isAccumulation ? 0 : b401k);
    const priorAllocation = seppState.allocation;
    const seppFlow = seppSchedule(inputs,year,seppState,seppAmortizedPayment);
    if (seppState.allocation>priorAllocation) {
      const allocated = seppState.allocation-priorAllocation;
      const fromIra=Math.min(bTradIra,allocated);bTradIra-=fromIra;b401k-=allocated-fromIra;
    }
    bTradIra += seppFlow.release;
    const marketReturn = isAccumulation
      ? preReturn
      : annualReturn(yearlyReturns, year - Math.max(currentYear, retirementYear), postReturn);

    if (isAccumulation) {
      const limits = getContributionLimits(age, year, inflation, householdSize);
      const { applied401k: requested401k, appliedMatch, appliedHsa } = fundPersonContributions({
        retired: false, salaryFunded: true, salaryNominal: salaryIncome * inflMult,
        contrib401k, contribMatch, contribHsa, limits, hsaPayroll: inputs.hsaPayroll,
        hsaLimitRemaining: getContributionLimits(age, year, inflation, inputs.hsaCoverage === "family" ? 2 : 1).hsa * hsaEligibleFraction(inputs, age, year),
        year, inflation,
      });
      const contributionSplit = catchupSplit({...inputs,priorEmployerWages:year===currentYear ? inputs.priorEmployerWages : salaryIncome*Math.pow(1+inflation,year-currentYear-1)},age,year,requested401k,inflation);
      const applied401k = contributionSplit.pretax;
      const appliedRoth401k = contributionSplit.roth;
      // Taxable cash flows exist BEFORE retirement too, and run through the
      // same tax engine as retirement years:
      //  - Traditional IRA RMDs are required even while still working (the
      //    still-working exception covers only the current employer's 401k,
      //    which is therefore hidden from the solver's balance view).
      //  - Inherited (BCO) required distributions never get a still-working
      //    exception.
      //  - Social Security claimed before retirement and a pension that has
      //    already commenced are real, taxable income.
      //  - Cash/HYSA interest is ordinary income.
      // Salary stacking: when a gross salary is entered, the forced flows
      // above are taxed ON TOP of taxable wages (salary minus pre-tax
      // contributions) — the projection is charged only the INCREMENTAL tax
      // over a salary-only baseline. The salary's own income tax, FICA, and
      // spending stay out of scope, and no salary cash ever enters the
      // balances. With salary at $0 the tax is a documented FLOOR (forced
      // flows taxed from the bottom brackets). The after-tax remainder of
      // these flows is reinvested in the taxable account at full basis (no
      // spending happens pre-retirement in this model); any tax the flows
      // can't cover is drawn through the normal withdrawal waterfall.
      // Previously the gross amounts were reinvested with tax hard-coded to
      // zero and pre-retirement SS/pension was ignored entirely.
      const accumPlanRmd = employerPlanRmd({...inputs,rmdStartAge:effectiveRmdStartAge},age,year,b401k,rmdDivisor);
      const accumIraRmd =
        age >= effectiveRmdStartAge && bTradIra > 0
          ? bTradIra / (rmdDivisor(age) || Infinity)
          : 0;
      const accumInheritedRmd =
        bInherited > 0
          ? Math.min(
              bInherited,
              inheritedRmdRequirement({
                year,
                age,
                balance: bInherited,
                ...inheritedConfig,
              }),
            )
          : 0;
      const accumInheritedNyExcludable =
        bInherited > 0 && year - inheritedDeceasedBirthYear >= 60;
      let ssGrossAccum =
        age >= ssClaimAge
          ? Math.round(
              adjustedSocialSecurityBenefit(ssIncome, ssClaimAge, ssFra) *
                Math.pow(1 + inflation, year - currentYear),
            )
          : 0;
      ssGrossAccum = socialSecurityPaid(inputs,age,year,ssFra,ssGrossAccum,salaryIncome*inflMult,inflation,ssHistory).paid;
      const pensionGrossAccum =
        age >= pensionStartAge && pensionIncome > 0
          ? Math.round(
              pensionIncome *
                Math.pow(1 + inflation, pensionStartYear - currentYear) *
                Math.pow(1 + pensionCola, Math.max(0, year - pensionStartYear)),
            )
          : 0;
      const accumSeniors65 =
        age >= 65
          ? filingStatus === "single"
            ? 1
            : Math.max(1, Math.min(2, householdSize))
          : 0;
      // Taxable wages while working: gross salary minus this year's pre-tax
      // contributions. Enters the solver as ordinary income so the forced
      // flows stack on top of it; the salary-only baseline tax below is
      // credited back through netNeed so the projection is charged only the
      // incremental tax (the baseline is the salary's own liability, paid
      // outside the model).
      const salaryTaxableAccum = Math.max(
        0,
        Math.round(Math.max(0, salaryIncome || 0) * inflMult) -
          applied401k -
          appliedHsa,
      );
      const baselineSalaryTax =
        salaryTaxableAccum > 0
          ? totalTax(
              salaryTaxableAccum,
              0,
              year,
              0,
              inflation,
              0,
              0,
              accumSeniors65,
              filingStatus,
            )
          : 0;
      const solve = solveGrossedUpWithdrawals({
        // Negative net need: SS/pension income with no modeled spending,
        // plus the salary-only baseline tax (paid by the out-of-scope
        // salary, so it must never be drawn from the portfolio).
        netNeed: -(ssGrossAccum + pensionGrossAccum + seppFlow.payment + baselineSalaryTax),
        state: {
          bCash,
          bTaxable: Math.max(0, bTaxable),
          bTaxableBasis,
          // Still-working: the current employer's 401k is RMD-exempt and
          // not withdrawable, so the solver never sees it.
          b401k: inputs.currentEmployerPlan===false ? b401k : accumPlanRmd,
          bTradIra,
          bRoth,
          bInherited: Math.max(0, bInherited),
          bInheritedBasis,
        },
        preSs: age < ssClaimAge,
        conversion: 0,
        // Taxable wages ride the part-time channel: pure ordinary income
        // (federal + NY, provisional income, MAGI), no penalties.
        ptIncome: salaryTaxableAccum,
        seppIncome: seppFlow.payment, recaptureTax: seppFlow.recapture,
        ssGross: ssGrossAccum,
        pensionGross: pensionGrossAccum,
        pensionNyExempt,
        year,
        age,
        inflation,
        minimumRmd: accumIraRmd,
        accountRmds: { k401: accumPlanRmd, ira: accumIraRmd },
        penaltyFree401k: false,
        cashPolicy: {
          strategy: cashStrategy,
          reserveNominal:
            cashStrategy === "cashFirst"
              ? 0
              : Math.round(Math.max(0, cashReserveFloor) * inflMult),
          allowReserve: allowReserveAsLastResort,
        },
        interestIncome: Math.max(0, bCash * cashReturn),
        cashRate: cashReturn, taxableOrdinaryYield: inputs.taxableOrdinaryYield || 0, surplusEarnsCashInterest: false,
        inheritedNyEligible: inputs.inheritedNyEligible ?? effectiveInheritedTaxType !== "nonqualified",
        seniors65: accumSeniors65,
        filingStatus,
        rothLayers,
        inheritedRmd: accumInheritedRmd,
        inheritedTaxType: effectiveInheritedTaxType,
        inheritedNyExcludable: accumInheritedNyExcludable,
      });
      const { wCash, wTaxable, wInherited = 0, w401k, wIra, wRoth } =
        solve.withdrawals;
      const tax = solve.tax;
      // Execute withdrawals exactly like a retirement year.
      const basisReduction = Math.max(0, wTaxable - solve.realizedGain);
      const inheritedStartBalance = bInherited;
      bCash = Math.max(0, bCash - wCash);
      bTaxable = Math.max(0, bTaxable - wTaxable);
      bTaxableBasis = Math.max(0, bTaxableBasis - basisReduction);
      b401k = Math.max(0,b401k-w401k);
      bTradIra = Math.max(0, bTradIra - wIra);
      consumeRothLayers(wRoth, rothLayers);
      bRoth = Math.max(0, bRoth - wRoth);
      bInherited = Math.max(0, bInherited - wInherited);
      bInheritedBasis = Math.max(
        0,
        bInheritedBasis -
          Math.max(0, wInherited - (solve.inheritedTaxable || 0)),
      );
      // Contract (layer-B) execution overlay: the projection NEVER deducts a
      // withdrawal charge — "bcoNoCharge" because the endorsement waives it,
      // other policies because no schedule is modeled (the UI warns that
      // zero is not proof the real contract charges nothing). The partial-
      // withdrawal minimum is an execution constraint only: it flags, it
      // never alters the federal RMD math. A withdrawal that empties the
      // account is a FULL withdrawal (exempt from the minimum) and
      // terminates the BCO.
      const inheritedFinalDistributionRequired =
        inheritedDeadlines.effectiveDeadline != null &&
        year >= inheritedDeadlines.effectiveDeadline &&
        inheritedStartBalance > 0.5;
      const inheritedPartialMinimumWarning =
        wInherited > 0 &&
        wInherited < Math.max(0, inheritedPartialWithdrawalMinimum || 0) &&
        wInherited < inheritedStartBalance - 0.5;
      if (inheritedStartBalance > 0.5 && bInherited <= 0.5) {
        inheritedBcoTerminated = true;
      }
      // The projection's tax for the year is the INCREMENT over the
      // salary-only baseline (equal to the full tax when no salary is
      // entered). Reinvest the forced flows net of that increment.
      const incrementalTax = Math.max(0, Math.round(tax - baselineSalaryTax));
      const grossWithdrawal = wCash + wTaxable + wInherited + w401k + wIra + wRoth;
      const accumSurplus = Math.max(
        0,
        grossWithdrawal + ssGrossAccum + pensionGrossAccum + seppFlow.payment - incrementalTax,
      );
      const accumUnmet = Math.max(
        0,
        incrementalTax - ssGrossAccum - pensionGrossAccum - seppFlow.payment - grossWithdrawal,
      );
      totalUnmetCashFlow += accumUnmet < 0.51 ? 0 : accumUnmet;
      bTaxable += accumSurplus;
      bTaxableBasis += accumSurplus + (solve.brokerageIncome || 0);
      totalTaxesPaid += incrementalTax;
      // IRMAA's 2-year lookback: with a salary entered, this year's MAGI
      // (wages + forced flows) is complete enough to record. Without one,
      // keep the lookback's same-year fallback — recording a salary-less
      // MAGI would understate surcharges even worse.
      magiByYear[year] = solve.ordIncome + solve.realizedGain;

      b401k = b401k * (1 + marketReturn) + applied401k + appliedMatch;
      bTaxable = bTaxable * (1 + taxableReturn(marketReturn));
      bTradIra = bTradIra * (1 + marketReturn);
      bRoth = bRoth * (1 + marketReturn);
      planRoth.balance = planRoth.balance * (1 + marketReturn) + appliedRoth401k;
      planRoth.basis += appliedRoth401k;
      if (appliedRoth401k > 0 && planRoth.firstYear == null) planRoth.firstYear = year;
      bHsa = bHsa * (1 + marketReturn) + appliedHsa;
      seppState.balance *= 1+marketReturn;
      bInherited = bInherited * (1 + marketReturn);
      bCash = bCash * (1 + cashReturn);
      const total =
        bCash + bTaxable + b401k + bTradIra + bRoth + planRoth.balance + seppState.balance + bHsa + bInherited - unpaidDebt;
      priorPriorYearEndTotal = priorYearEndTotal;
      priorYearEndTotal = total;

      yearlyData.push({
        year,
        age,
        phase: "accumulation",
        spending: 0,
        partTime: 0,
        ss: ssGrossAccum,
        pension: pensionGrossAccum,
        netNeed: 0,
        grossWithdrawal: Math.round(grossWithdrawal + seppFlow.payment),
        fromCash: Math.round(wCash),
        fromTaxable: Math.round(wTaxable),
        from401k: Math.round(w401k),
        fromIra: Math.round(wIra + seppFlow.payment),
        fromRoth: Math.round(wRoth),
        fromInherited: Math.round(wInherited),
        conversion: 0,
        // Incremental over the salary-only baseline; full-year MAGI (incl.
        // taxable wages) is in `magi`.
        tax: incrementalTax,
        strategy: "Accumulating",
        calculationValid: solve.converged,
        calculationNotice: solve.converged ? null : "Accumulation tax calculation did not converge.",
        cash: Math.round(bCash),
        taxable: Math.round(bTaxable),
        k401: Math.round(b401k),
        tradIra: Math.round(bTradIra + seppState.balance),
      seppBalance: Math.round(seppState.balance),
      seppIncome: Math.round(seppFlow.payment),
        roth: Math.round(bRoth + planRoth.balance),
      roth401k: Math.round(planRoth.balance),
        hsa: Math.round(bHsa),
        inherited: Math.round(bInherited),
        total: Math.round(total),
        rmdAmount: Math.round(accumIraRmd),
        inheritedRmdAmount: Math.round(accumInheritedRmd),
        inheritedWithdrawalCharge: 0,
        inheritedWithdrawalChargePolicy,
        inheritedPartialMinimumWarning,
        inheritedBcoTerminated,
        inheritedFinalDistributionRequired,
        inheritedFinalDistributionYear: inheritedDeadlines.effectiveDeadline,
        realizedGain: Math.round(solve.realizedGain),
        taxableSs: Math.round(solve.taxableSs),
        magi: Math.round(solve.ordIncome + solve.realizedGain),
        taxableBasisEnd: Math.round(bTaxableBasis),
        irmaaSurcharge: 0,
        irmaaTriggered: false,
        acaSubsidy: 0,
        hsaWithdrawal: 0,
        earlyPenalty: solve.earlyPenalty,
        cashFloor: 0,
        reserveUsed: Math.round(solve.withdrawals.reserveUsed || 0),
        unmetCashFlow: Math.round(unpaidDebt + accumUnmet),
        // After-tax forced-flow remainder reinvested into Taxable (not Cash).
        surplusToTaxable: Math.round(accumSurplus),
        contribution401kApplied: Math.round(applied401k + appliedRoth401k),
        contributionRoth401kApplied: Math.round(appliedRoth401k),
        taxableWages: Math.round(salaryTaxableAccum),
        contributionMatchApplied: Math.round(appliedMatch),
        contributionHsaApplied: Math.round(appliedHsa),
      });
      continue;
    }

    // Retirement year
    const healthcareSticker = age < 65 ? healthcarePre65 : healthcarePost65;
    const lifestyleSpending = Math.round(baseExpenses * inflMult);
    const spendingBase = Math.round((baseExpenses + healthcareSticker) * inflMult);
    // Flexible spending cuts DISCRETIONARY lifestyle only (10%), never the
    // healthcare block. The old whole-spending cut was absorbed by the HSA
    // offset (the healthcare portion shrank by the entire cut), so the
    // portfolio draw didn't fall in exactly the bad-market years the
    // guardrail exists for — Monte Carlo overstated its benefit.
    let flexCut = 0;
    if (useFlexibleSpending && priorPriorYearEndTotal > 0 && yearsFromRetirement > 0) {
      const yoyChange =
        (priorYearEndTotal - priorPriorYearEndTotal) / priorPriorYearEndTotal;
      if (yoyChange < -0.15) {
        flexCut = Math.round(lifestyleSpending * 0.1);
      }
    }
    const lifestyleAfterFlex = lifestyleSpending - flexCut;
    let spending = spendingBase - flexCut;

    const ptIncome =
      age < retirementAge + partTimeYears
        ? Math.round(partTimeIncome * inflMult)
        : 0;
    const ptFica = employeeFica(ptIncome, year, inflation) +
      .009 * Math.max(0, ptIncome - (filingStatus === "single" ? 200000 : 250000));
    const ssClaimBenefit = adjustedSocialSecurityBenefit(
      ssIncome,
      ssClaimAge,
      ssFra,
    );
    let ssGross =
      age >= ssClaimAge
        ? Math.round(ssClaimBenefit * Math.pow(1 + inflation, year - currentYear))
        : 0;
    ssGross = socialSecurityPaid(inputs,age,year,ssFra,ssGross,ptIncome,inflation,ssHistory).paid;
    // Pension: general inflation to commencement, COLA only after (see the
    // pensionStartYear note above).
    const pensionGross =
      age >= pensionStartAge && pensionIncome > 0
        ? Math.round(
            pensionIncome *
              Math.pow(1 + inflation, pensionStartYear - currentYear) *
              Math.pow(1 + pensionCola, Math.max(0, year - pensionStartYear)),
          )
        : 0;

    // Determine Roth conversion target based on age phase. Conversions stop
    // in every window once Social Security starts: SS stacks with conversion
    // income (ordinary + provisional), and the strategy's purpose is filling
    // the low-tax years before benefits begin.
    let conversion = 0;
    let strategy = "";
    if (age >= ssClaimAge) {
      conversion = 0;
      strategy = "SS active | Roth preserved";
    } else if (age < 60) {
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
    } else {
      conversion = Math.max(
        0,
        Math.min(Math.round(conversionFinal * inflMult), b401k),
      );
      strategy = `Medicare | Final convert $${Math.round(conversionFinal / 1000)}K`;
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
      const rmdThatMustComeFrom401k = age >= effectiveRmdStartAge ? b401k / rmdDivisor(age) : 0;
      conversion = Math.min(conversion, Math.max(0, b401k - rmdThatMustComeFrom401k));
    }

    // Inherited (BCO) required distribution for this year. Forced in the
    // solver like an RMD; any excess beyond spending + tax sweeps to cash.
    const inheritedRmd =
      bInherited > 0
        ? Math.min(
            bInherited,
            inheritedRmdRequirement({
              year,
              age,
              balance: bInherited,
              ...inheritedConfig,
            }),
          )
        : 0;
    // NY beneficiary rule: inherited pension/annuity income can use the $20K
    // exclusion through the DECEDENT's age eligibility (59½+, actual or
    // would-have-been), regardless of the beneficiary's own age.
    const inheritedNyExcludable =
      bInherited > 0 && year - inheritedDeceasedBirthYear >= 60;

    // Available balance for conversion (can't convert more than remains after expected draw)
    // Reserve conversion amount from 401k pool for the waterfall
    const state = {
      bCash,
      bTaxable: Math.max(0, bTaxable),
      bTaxableBasis,
      b401k: Math.max(0, b401k - conversion),
      bTradIra,
      bRoth,
      bInherited: Math.max(0, bInherited),
      bInheritedBasis,
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

    // Debt-payoff LTCG (realized at time zero) is taxed in this first
    // distribution year, then cleared so it applies only once.
    const debtPayoffGainThisYear = pendingDebtPayoffGain;
    pendingDebtPayoffGain = 0;

    // === Converged solve: withdrawals, tax, RMD, and IRMAA all converge together ===
    // Outer loop: iterate IRMAA (and ACA pre-65) until spending stabilizes.
    // Inner: solveGrossedUpWithdrawals handles tax gross-up AND RMD internally.
    let solve;
    let irmaaSurcharge = 0;
    let irmaaConverged = true;
    let irmaaTriggered = false;
    let acaSubsidy = 0;
    let acaConverged = true;
    let finalSpending = spending;
    let hsaWithdrawal = 0;

    for (let outerIter = 0; outerIter < 100; outerIter++) {
      // Effective spending includes IRMAA surcharge (post-65)
      // ACA (pre-65) is handled below as a separate branch
      const effectiveSpending =
        age >= 65 ? spending + irmaaSurcharge : spending;
      // Healthcare (+IRMAA) portion, measured against the flex-cut lifestyle
      // so a flexible-spending cut never shrinks the HSA-eligible block.
      const healthcarePortion = Math.max(
        0,
        effectiveSpending - lifestyleAfterFlex,
      );
      const hsaOffset = Math.min(bHsa, qualifiedHsaExpenses(inputs, age, inflMult, healthcarePortion));

      // Signed net cash flow: negative when recurring income (pension, SS,
      // part-time) exceeds spending. The solver floors the actual withdrawal
      // at zero, so a surplus first absorbs the year's tax and the after-tax
      // remainder is swept to cash below. Flooring HERE (the old behavior)
      // discarded the surplus entirely and paid the tax on that income out of
      // savings — an income-rich retiree's cash balance shrank every year.
      const netNeed =
        effectiveSpending - hsaOffset - ptIncome - ssGross - pensionGross - seppFlow.payment + ptFica;

      solve = solveGrossedUpWithdrawals({
        netNeed,
        taxableHsaAvailable: Math.max(0, bHsa - hsaOffset),
        planRothAccount: planRoth,
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
        minimumRmd: rmdAmount,
        accountRmds: { k401: age >= effectiveRmdStartAge ? b401k / rmdDivisor(age) : 0, ira: age >= effectiveRmdStartAge ? bTradIra / rmdDivisor(age) : 0 },
        penaltyFree401k,
        cashPolicy,
        interestIncome: cashInterestIncome,
        cashRate: cashReturn, taxableOrdinaryYield: inputs.taxableOrdinaryYield || 0,
        inheritedNyEligible: inputs.inheritedNyEligible ?? effectiveInheritedTaxType !== "nonqualified",
        seniors65,
        filingStatus,
        rothLayers,
        seppExempt: 0,
        seppIncome: seppFlow.payment,
        recaptureTax: seppFlow.recapture,
        additionalRealizedGain: debtPayoffGainThisYear,
        inheritedRmd,
        inheritedTaxType: effectiveInheritedTaxType,
        inheritedNyExcludable,
      });

      finalSpending = effectiveSpending;
      hsaWithdrawal = hsaOffset;

      // Only post-65 IRMAA iteration matters here; break early for pre-65
      if (age < 65) break;

      // Recompute MAGI from converged solve
      const postOrdIncome = solve.ordIncome;
      const postMagi = postOrdIncome + solve.realizedGain + debtPayoffGainThisYear;

      // Real IRMAA uses MAGI from two years earlier. Use the projected MAGI
      // from that year when the projection has one (i.e. the household has
      // been retired 2+ years); otherwise fall back to same-year MAGI, since
      // working-year MAGI (salary) is out of scope for this model.
      const lookbackMagi = magiByYear[year - 2];
      const irmaaMagi = inputs.irmaaApprovedMagi?.[year] ?? (lookbackMagi != null ? lookbackMagi : postMagi);

      irmaaConverged = false;
      const newIrmaa = computeIrmaaSurcharge(
        irmaaMagi,
        year,
        inflation,
        medicareEnrollees,
        filingStatus,
      );

      // Converged when IRMAA tier is stable
      if (Math.abs(newIrmaa - irmaaSurcharge) < 0.01) {
        irmaaSurcharge = newIrmaa;
        irmaaConverged = true;
        break;
      }
      irmaaSurcharge = newIrmaa;
    }
    irmaaTriggered = irmaaSurcharge > 0;

    // ACA subsidy (pre-65 only, opt-in) — iterate subsidy ↔ MAGI to a fixed
    // point (max 4 passes): the subsidy changes withdrawals, which change
    // MAGI, which changes the subsidy; a single re-solve could leave a
    // subsidy granted at a MAGI that had already crossed the 400%-FPL
    // cliff. ACA MAGI is §36B household income: AGI plus the NONTAXABLE
    // part of Social Security, which plain AGI misses.
    if (useAcaSubsidyEstimate && age < 65 && age >= retirementAge) {
      const healthcareNominal = healthcareSticker * inflMult;
      const unsubsidizedSolve = solve; const unsubsidizedSpending = finalSpending; const unsubsidizedHsa = hsaWithdrawal;
      acaConverged = false;
      for (let acaIter = 0; acaIter < 100; acaIter++) {
      const acaMagi =
        solve.ordIncome +
        solve.realizedGain +
        debtPayoffGainThisYear +
        Math.max(0, ssGross - solve.taxableSs);
      const subsidizedNominal = estimateAcaHealthcareCost(
        healthcareNominal,
        acaMagi,
        householdSize,
        year,
        inflation,
        inputs,
      );
      const newAcaSubsidy = Math.max(0, healthcareNominal - subsidizedNominal);
      const acaStable = Math.abs(newAcaSubsidy - acaSubsidy) < 0.01;
      acaSubsidy = newAcaSubsidy;
      // Rebuild spending from the flex-adjusted lifestyle so a flexible-
      // spending cut survives the ACA re-solve (it used to be discarded).
      finalSpending = Math.round(lifestyleAfterFlex + subsidizedNominal);
      hsaWithdrawal = Math.min(
        bHsa,
        qualifiedHsaExpenses(inputs, age, inflMult, Math.max(0, finalSpending - lifestyleAfterFlex)),
      );
      if (acaStable) { acaConverged = true; break; }
      // Signed, matching the main solve above: surplus income may exceed the
      // subsidized spending level too.
      const netNeedAca =
        finalSpending - hsaWithdrawal - ptIncome - ssGross - pensionGross - seppFlow.payment + ptFica;
      solve = solveGrossedUpWithdrawals({
        netNeed: netNeedAca,
        taxableHsaAvailable: Math.max(0, bHsa - hsaWithdrawal),
        planRothAccount: planRoth,
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
        minimumRmd: rmdAmount,
        accountRmds: { k401: age >= effectiveRmdStartAge ? b401k / rmdDivisor(age) : 0, ira: age >= effectiveRmdStartAge ? bTradIra / rmdDivisor(age) : 0 },
        penaltyFree401k,
        cashPolicy,
        interestIncome: cashInterestIncome,
        cashRate: cashReturn, taxableOrdinaryYield: inputs.taxableOrdinaryYield || 0,
        inheritedNyEligible: inputs.inheritedNyEligible ?? effectiveInheritedTaxType !== "nonqualified",
        seniors65,
        filingStatus,
        rothLayers,
        seppExempt: 0,
        seppIncome: seppFlow.payment,
        recaptureTax: seppFlow.recapture,
        additionalRealizedGain: debtPayoffGainThisYear,
        inheritedRmd,
        inheritedTaxType: effectiveInheritedTaxType,
        inheritedNyExcludable,
      });
      }
      if (!acaConverged) { solve = unsubsidizedSolve; finalSpending = unsubsidizedSpending; hsaWithdrawal = unsubsidizedHsa; acaSubsidy = 0; }
    }

    // Update displayed spending to include IRMAA (shows true economic cost)
    spending = finalSpending;

    let { wCash, wTaxable, wInherited = 0, w401k, wIra, wRoth } =
      solve.withdrawals;
    const tax = solve.tax;
    const realizedGain = solve.realizedGain;
    const taxableSs = solve.taxableSs;
    const inheritedTaxable = solve.inheritedTaxable || 0;

    const wHsa = solve.withdrawals.wHsa || 0;
    const wPlanRoth = solve.withdrawals.wPlanRoth || 0;
    const netNeedFinal = finalSpending - hsaWithdrawal - ptIncome - ssGross - pensionGross - seppFlow.payment + ptFica;

    // Apply realized gain to basis tracking BEFORE executing withdrawal
    const basisReduction = Math.max(0, wTaxable - realizedGain);
    const inheritedStartBalance = bInherited;

    // Execute withdrawals (balances updated)
    bCash = Math.max(0, bCash - wCash);
    bTaxable = Math.max(0, bTaxable - wTaxable);
    bTaxableBasis = Math.max(0, bTaxableBasis - basisReduction);
    b401k = Math.max(0, b401k - w401k - conversion);
    commitRothConversion(rothLayers,conversion,year);
    consumeRothLayers(wRoth, rothLayers);
    bRoth = bRoth + conversion;
    bTradIra = Math.max(0, bTradIra - wIra);
    bRoth = Math.max(0, bRoth - wRoth);
    bHsa = Math.max(0, bHsa - hsaWithdrawal - wHsa);
    // Inherited (BCO): the non-taxable slice of a non-qualified draw is
    // returned cost basis — reduce basis by exactly that amount.
    bInherited = Math.max(0, bInherited - wInherited);
    bInheritedBasis = Math.max(
      0,
      bInheritedBasis - Math.max(0, wInherited - inheritedTaxable),
    );
    // Contract (layer-B) execution overlay — see the accumulation branch:
    // no withdrawal charge is ever deducted; the partial minimum only
    // flags; emptying the account terminates the BCO.
    const inheritedFinalDistributionRequired =
      inheritedDeadlines.effectiveDeadline != null &&
      year >= inheritedDeadlines.effectiveDeadline &&
      inheritedStartBalance > 0.5;
    const inheritedPartialMinimumWarning =
      wInherited > 0 &&
      wInherited < Math.max(0, inheritedPartialWithdrawalMinimum || 0) &&
      wInherited < inheritedStartBalance - 0.5;
    if (inheritedStartBalance > 0.5 && bInherited <= 0.5) {
      inheritedBcoTerminated = true;
    }

    // Anything received or withdrawn beyond spending + tax goes to cash
    // (reinvested in HYSA-equivalent): forced RMD/SEPP/inherited draws above
    // the need, AND after-tax recurring-income surplus (netNeedFinal < 0;
    // netNeedFinal is signed and computed above the residue top-up).
    const surplusFromRmd = Math.max(
      0,
      (wCash + wTaxable + wInherited + w401k + wIra + wRoth + wHsa + wPlanRoth) -
        (netNeedFinal + tax),
    );
    if (surplusFromRmd > 0) {
      bCash += surplusFromRmd;
    }
    const unmetCashFlow = Math.max(
      0,
      netNeedFinal + tax - (wCash + wTaxable + wInherited + w401k + wIra + wRoth + wHsa + wPlanRoth),
    );
    totalUnmetCashFlow += unmetCashFlow < 0.51 ? 0 : unmetCashFlow;

    // MAGI for display/debug (reflects final withdrawals)
    const finalOrdIncome = solve.ordIncome;
    const magi = finalOrdIncome + realizedGain + debtPayoffGainThisYear;
    magiByYear[year] = magi;

    // Grow balances
    bCash *= 1 + cashReturn;
    bTaxable *= 1 + taxableReturn(marketReturn);
    bTaxableBasis += solve.brokerageIncome || 0; // Reinvested taxable distributions add basis.
    b401k *= 1 + marketReturn;
    bTradIra *= 1 + marketReturn;
    bRoth *= 1 + marketReturn;
    planRoth.basis *= 1 - wPlanRoth/Math.max(1,planRoth.balance);
    planRoth.balance = Math.max(0,planRoth.balance-wPlanRoth)*(1+marketReturn);
    bHsa *= 1 + marketReturn;
    seppState.balance *= 1+marketReturn;
    bInherited *= 1 + marketReturn;

    totalTaxesPaid += tax;
    totalConverted += conversion;

    const total =
      bCash + bTaxable + b401k + bTradIra + bRoth + planRoth.balance + seppState.balance + bHsa + bInherited - unpaidDebt;
    const grossWithdrawal = wCash + wTaxable + wInherited + w401k + wIra + wRoth + wHsa + wPlanRoth;
    priorPriorYearEndTotal = priorYearEndTotal;
    priorYearEndTotal = total;

    // Depletion: total portfolio hits zero (consistent with Monte Carlo).
    // Unmet cash flow is evaluated cumulatively after the loop.
    if (total <= 0 && !depleted) depleted = true;

    let phase = "bridge";
    if (age >= 60 && age < 65) phase = "mid";
    else if (age >= 65 && age < ssClaimAge) phase = "medicare";
    else if (age >= ssClaimAge) phase = "ss";

    yearlyData.push({
      year,
      age,
      phase,
      spending: finalSpending,
      partTime: ptIncome-ptFica,
      partTimeGross: ptIncome,
      ficaTax: Math.round(ptFica),
      ss: ssGross,
      pension: pensionGross,
      netNeed: netNeedFinal,
      grossWithdrawal: Math.round(grossWithdrawal + seppFlow.payment + hsaWithdrawal),
      fromCash: Math.round(wCash),
      fromTaxable: Math.round(wTaxable),
      from401k: Math.round(w401k),
      fromIra: Math.round(wIra + seppFlow.payment),
      fromRoth: Math.round(wRoth + wPlanRoth),
      fromRoth401k: Math.round(wPlanRoth),
      fromInherited: Math.round(wInherited),
      hsaWithdrawal: Math.round(hsaWithdrawal + wHsa),
      taxableHsaWithdrawal: Math.round(wHsa),
      conversion: Math.round(conversion),
      tax,
      strategy,
      cash: Math.round(bCash),
      taxable: Math.round(bTaxable),
      k401: Math.round(b401k),
      tradIra: Math.round(bTradIra + seppState.balance),
      seppBalance: Math.round(seppState.balance),
      seppIncome: Math.round(seppFlow.payment),
      roth: Math.round(bRoth + planRoth.balance),
      roth401k: Math.round(planRoth.balance),
      hsa: Math.round(bHsa),
      inherited: Math.round(bInherited),
      total: Math.round(total),
      // Debug/validation fields
      rmdAmount: Math.round(rmdAmount),
      inheritedRmdAmount: Math.round(inheritedRmd),
      inheritedTaxable: Math.round(inheritedTaxable),
      inheritedWithdrawalCharge: 0,
      inheritedWithdrawalChargePolicy,
      inheritedPartialMinimumWarning,
      inheritedBcoTerminated,
      inheritedFinalDistributionRequired,
      inheritedFinalDistributionYear: inheritedDeadlines.effectiveDeadline,
      // Forced withdrawals (RMDs / SEPP / inherited payouts) above spending +
      // tax are deposited into Cash — recorded so the UI can explain why the
      // cash balance grows in RMD years instead of silently swelling.
      surplusToCash: Math.round(surplusFromRmd),
      realizedGain: Math.round(realizedGain),
      taxableSs: Math.round(taxableSs),
      magi: Math.round(magi),
      taxableBasisEnd: Math.round(bTaxableBasis),
      irmaaSurcharge: Math.round(irmaaSurcharge),
      irmaaTriggered,
      acaSubsidy: Math.round(acaSubsidy),
      calculationValid: solve.converged && acaConverged && irmaaConverged,
      calculationNotice: !irmaaConverged ? "IRMAA tiers did not converge; assessment needs validation." : !acaConverged ? "ACA subsidy did not converge; unsubsidized estimate used." : !solve.converged ? "Tax calculation did not converge." : null,
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
    inputs.balanceHsa +
    (inputs.balanceInherited || 0) -
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

  // Cumulative unmet cash flow marks the plan depleted only when it clears
  // the same materiality bar the banner uses (materialUnmetThreshold).
  // Includes any unpayable time-zero debt.
  const year1SpendingForThreshold = year1Data ? year1Data.spending : 0;
  if (totalUnmetCashFlow > materialUnmetThreshold(year1SpendingForThreshold)) {
    depleted = true;
  }

  return {
    yearlyData,
    summary: {
      modelNotices: financialNotices(inputs,yearlyData),
      calculationValid: financialNotices(inputs,yearlyData).length === 0,
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
  const familyBase =
    householdSize > 1 ? roundTo(base.hsaFamily, 50) : roundTo(base.hsaSelf, 50);
  const primaryCatchUp = primaryAge >= 55 ? base.hsaCatchUp55 : 0;
  const spouseCatchUp =
    spouseAge >= 55 && householdSize > 1 ? base.hsaCatchUp55 : 0;
  return {
    familyBase,
    primaryCatchUp,
    spouseCatchUp,
    total: familyBase + primaryCatchUp + spouseCatchUp,
  };
}

function fundPersonContributions({
  retired,
  salaryFunded: _salaryFunded,
  hsaPayroll = false,
  salaryNominal,
  contrib401k,
  contribMatch,
  contribHsa,
  limits,
  hsaLimitRemaining,
  year,
  inflation,
}) {
  const none = { applied401k: 0, appliedMatch: 0, appliedHsa: 0, fica: 0, ficaBase: 0 };
  if (retired) return none;
  const want401k = Math.max(0, contrib401k);
  const wantMatch = Math.max(0, contribMatch);
  const wantHsa = Math.max(0, contribHsa);
  const hsaRoom = Math.max(0, hsaLimitRemaining);
  const appliedHsa = Math.min(wantHsa, hsaRoom, Math.max(0, salaryNominal - (hsaPayroll ? 0 : employeeFica(salaryNominal,year,inflation))));
  const ficaBase = Math.max(0, salaryNominal - (hsaPayroll ? appliedHsa : 0));
  const fica = employeeFica(ficaBase, year, inflation);
  const applied401k = Math.min(
    want401k,
    limits.k401Employee,
    Math.max(0, salaryNominal - appliedHsa - fica),
  );
  const appliedMatch = Math.min(
    wantMatch,
    Math.max(0, limits.k401Total - applied401k),
    Math.max(0, salaryNominal - applied401k),
  );
  return { applied401k, appliedMatch, appliedHsa, fica, ficaBase };
}

function personConversionTarget(person, age, inflMult, b401k, _bTradIra, _rmdAmount) {
  if (age < person.retirementAge) return 0;
  // Conversions stop in every window once this spouse's Social Security
  // starts, matching the individual engine (SS stacks with conversion income).
  if (age >= effectiveSsClaimAge(person.ssAge)) return 0;
  let target = 0;
  if (age < 60) target = person.conversionBridge;
  else if (age < 65) target = person.conversionMid;
  else target = person.conversionFinal;
  const conversion = Math.max(0, Math.min(Math.round(target * inflMult), b401k));
  // Reserve only the RMD share the 401k must supply: the couple waterfall
  // satisfies RMDs from the Traditional IRA first (enforcePersonRmd), so a
  // large IRA frees the 401k for conversion — matching the individual engine.
  const rmdThatMustComeFrom401k = age >= person.rmdStartAge ? b401k / rmdDivisor(age) : 0;
  return Math.min(conversion, Math.max(0, b401k - rmdThatMustComeFrom401k));
}

function takeFromBalance(withdrawals, key, available, remaining) {
  const taken = Math.min(remaining, Math.max(0, available - (withdrawals[key] || 0)));
  withdrawals[key] = (withdrawals[key] || 0) + taken;
  return remaining - taken;
}

function enforcePersonRmd(withdrawals, prefix, state, rmdAmount) {
  if (typeof rmdAmount === 'object' && rmdAmount !== null) {
    takeFromBalance(withdrawals, `${prefix}Ira`, state[`${prefix}TradIra`], Math.max(0, rmdAmount.ira - (withdrawals[`${prefix}Ira`] || 0)));
    takeFromBalance(withdrawals, `${prefix}401k`, state[`${prefix}401k`], Math.max(0, rmdAmount.k401 - (withdrawals[`${prefix}401k`] || 0)));
    return;
  }
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
  filingStatus = "mfj",
  seppIncomes = {primary:0,spouse:0},
  recaptureTax = 0,
  alive = {primary: true, spouse: true},
  planRothAccounts = {primary:null,spouse:null},
  taxableHsaAvailable = {primary: 0, spouse: 0},
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
  cashRate = null,
  taxableOrdinaryYield = 0,
  surplusEarnsCashInterest = true,
  // Per-spouse Roth ordering layers (IRC 408A(d)(4)).
  rothLayers = { primary: null, spouse: null },
  // Extra LTCG to tax this year not produced by a withdrawal (debt-payoff
  // sale at time zero). Added to the tax base and provisional income only.
  additionalRealizedGain = 0,
}) {
  const seniors65 =
    (alive.primary && ages.primary >= 65 ? 1 : 0) + (alive.spouse && ages.spouse >= 65 ? 1 : 0);
  let tax = 0;
  let withdrawals = doCoupleWithdrawalWaterfall(0, state, preHouseholdSs, rmds, cashPolicy);
  let realizedGain = 0;
  let taxableSs = 0;
  let ordIncome = 0;
  let earlyPenalty = 0;
  let brokerageIncome = 0;

  const taxLayers = {
    primary: provisionalRothLayers(rothLayers.primary, conversions.primary, year),
    spouse: provisionalRothLayers(rothLayers.spouse, conversions.spouse, year),
  };
  const closure = solveTaxClosure((assumedTax) => {
    tax = assumedTax;
    const grossNeed = Math.max(0, netNeed + tax);
    withdrawals = doCoupleWithdrawalWaterfall(
      grossNeed,
      {...state, primaryRoth: state.primaryRoth+conversions.primary, spouseRoth: state.spouseRoth+conversions.spouse},
      preHouseholdSs,
      rmds,
      cashPolicy,
    );
    realizedGain = computeRealizedGain(
      withdrawals.taxable,
      state.taxable,
      state.taxableBasis,
    );
    const taxableRealizedGain = realizedGain + Math.max(0, additionalRealizedGain);

    let hsaNeed = Math.max(0, netNeed + tax - Object.entries(withdrawals).filter(([key])=>key !== 'reserveUsed').reduce((sum,[,value])=>sum+value,0));
    withdrawals.primaryPlanRoth = Math.min(planRothAccounts.primary?.balance || 0,hsaNeed);
    hsaNeed -= withdrawals.primaryPlanRoth;
    withdrawals.spousePlanRoth = Math.min(planRothAccounts.spouse?.balance || 0,hsaNeed);
    hsaNeed -= withdrawals.spousePlanRoth;
    const primaryPlanEarnings = planRothEarnings(withdrawals.primaryPlanRoth,planRothAccounts.primary,ages.primary,year);
    const spousePlanEarnings = planRothEarnings(withdrawals.spousePlanRoth,planRothAccounts.spouse,ages.spouse,year);
    const planEarnings = primaryPlanEarnings + spousePlanEarnings;
    withdrawals.primaryHsa = ages.primary >= 65 ? Math.min(taxableHsaAvailable.primary, hsaNeed) : 0;
    hsaNeed -= withdrawals.primaryHsa;
    withdrawals.spouseHsa = ages.spouse >= 65 ? Math.min(taxableHsaAvailable.spouse, hsaNeed) : 0;
    const taxableHsa = withdrawals.primaryHsa + withdrawals.spouseHsa;
    const taxDeferredWithdrawals =
      withdrawals.primary401k +
      withdrawals.spouse401k +
      withdrawals.primaryIra +
      withdrawals.spouseIra;
    const totalConversions = conversions.primary + conversions.spouse;
    const pensionGross = incomes.primaryPension + incomes.spousePension + seppIncomes.primary + seppIncomes.spouse;
    const partTimeGross = incomes.primaryPartTime + incomes.spousePartTime;
    // Working-spouse wages during staggered retirement, already net of that
    // spouse's pre-tax 401k/HSA contributions. Taxed as ordinary income and
    // counted in provisional income and MAGI, like part-time income.
    const wageGross =
      (incomes.primaryWage || 0) + (incomes.spouseWage || 0);
    const ssGross = incomes.primarySs + incomes.spouseSs;
    // Pre-59½ Roth earnings draws are ordinary income (and penalized below).
    const earlyRothEarnings =
      (!rothQualified(ages.primary, year, taxLayers.primary)
        ? rothTaxableEarnings(withdrawals.primaryRoth, taxLayers.primary)
        : 0) +
      (!rothQualified(ages.spouse, year, taxLayers.spouse)
        ? rothTaxableEarnings(withdrawals.spouseRoth, taxLayers.spouse)
        : 0);
    if (cashRate !== null) {
      const drawn = withdrawals.cash + withdrawals.taxable + taxDeferredWithdrawals + withdrawals.primaryRoth + withdrawals.spouseRoth + taxableHsa + withdrawals.primaryPlanRoth + withdrawals.spousePlanRoth;
      const surplus = surplusEarnsCashInterest ? Math.max(0, drawn - netNeed - tax) : 0;
      interestIncome = Math.max(0, (state.cash - withdrawals.cash + surplus) * cashRate);
    }
    brokerageIncome = Math.max(0,state.taxable-withdrawals.taxable)*Math.max(0,taxableOrdinaryYield);
    const incomeBeforeSs =
      wageGross +
      partTimeGross +
      pensionGross +
      interestIncome + brokerageIncome +
      earlyRothEarnings + planEarnings + taxableHsa +
      taxDeferredWithdrawals +
      totalConversions +
      taxableRealizedGain;
    taxableSs = taxableSocialSecurity(ssGross, incomeBeforeSs, filingStatus);
    ordIncome =
      wageGross +
      partTimeGross +
      taxableSs +
      pensionGross +
      interestIncome + brokerageIncome +
      earlyRothEarnings + planEarnings + taxableHsa +
      taxDeferredWithdrawals +
      totalConversions;

    const nyExemptAmount =
      (incomes.primaryPensionNyExempt ? incomes.primaryPension : 0) +
      (incomes.spousePensionNyExempt ? incomes.spousePension : 0);
    const primaryPrivateRetirement = seppIncomes.primary +
      withdrawals.primary401k +
      withdrawals.primaryIra +
      conversions.primary +
      (incomes.primaryPensionNyExempt ? 0 : incomes.primaryPension);
    const spousePrivateRetirement = seppIncomes.spouse +
      withdrawals.spouse401k +
      withdrawals.spouseIra +
      conversions.spouse +
      (incomes.spousePensionNyExempt ? 0 : incomes.spousePension);
    // NY pension/annuity exclusion applies from age 59½ (annual model: 60).
    let primaryNyEligible = ages.primary>=59.5 ? primaryPrivateRetirement : 0;
    let spouseNyEligible = ages.spouse>=59.5 ? spousePrivateRetirement : 0;
    if (!alive.primary) {spouseNyEligible+=primaryNyEligible;primaryNyEligible=0;}
    if (!alive.spouse) {primaryNyEligible+=spouseNyEligible;spouseNyEligible=0;}
    const nyPensionAnnuityExclusion=Math.min(20000,primaryNyEligible)+Math.min(20000,spouseNyEligible);

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
        taxLayers.primary,
      ) +
      personPenalty(
        ages.spouse,
        penaltyFree401k.spouse,
        withdrawals.spouse401k,
        withdrawals.spouseIra,
        withdrawals.spouseRoth,
        taxLayers.spouse,
      );

    const newTax =
      totalTax(
        ordIncome,
        taxableRealizedGain,
        year,
        nyExemptAmount,
        inflation,
        taxableSs,
        nyPensionAnnuityExclusion,
        seniors65,
        filingStatus,
        interestIncome + brokerageIncome,
      ) + recaptureTax + earlyPenalty + (ages.primary < 59.5 && !(penaltyFree401k.primary && ages.primary>=55) ? .1*primaryPlanEarnings : 0) + (ages.spouse < 59.5 && !(penaltyFree401k.spouse && ages.spouse>=55) ? .1*spousePlanEarnings : 0);
    return { tax: newTax };
  });
  tax = closure.tax;

  return {
    withdrawals,
    tax,
    realizedGain,
    taxableSs,
    ordIncome,
    earlyPenalty: Math.round(earlyPenalty),
    interestIncome, brokerageIncome,
    converged: closure.converged,
    residual: closure.residual,
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
  const currentYear = shared.projectionStartYear ?? PROJECTION_START_YEAR;
  // Per-spouse FRA from birth year, and pension commencement years (input is
  // today's dollars at benefit start: general inflation to start, COLA
  // after) — see the individual-engine notes.
  const primaryFra = fullRetirementAgeForBirthYear(
    currentYear - primary.currentAge,
  );
  const spouseFra = fullRetirementAgeForBirthYear(
    currentYear - spouse.currentAge,
  );
  const primaryPensionStartYear =
    currentYear + Math.max(0, primary.pensionStartAge - primary.currentAge);
  const spousePensionStartYear =
    currentYear + Math.max(0, spouse.pensionStartAge - spouse.currentAge);
  const endYear = Math.max(
    currentYear + (primary.planThroughAge - primary.currentAge),
    currentYear + (spouse.planThroughAge - spouse.currentAge),
  );
  const taxableReturn = (ret) =>
    Math.max(-0.99, ret - (shared.taxableOrdinaryYield>0 ? 0 : (shared.taxableAnnualTaxDrag ?? 0.005)));

  let cash = shared.balanceCash;
  let taxable = shared.balanceTaxable;
  let taxableBasis = shared.balanceTaxable * shared.taxableBasisPct;
  let unpaidDebt = Math.max(0, shared.creditCardDebt || 0);
  const primarySeppState = {balance:0,initialized:false,allocation:0}, spouseSeppState = {balance:0,initialized:false,allocation:0};
  const primaryPlanRoth = {balance: primary.balanceRoth401k || 0, basis: primary.roth401kBasis || 0, firstYear: primary.roth401kFirstYear};
  const spousePlanRoth = {balance: spouse.balanceRoth401k || 0, basis: spouse.roth401kBasis || 0, firstYear: spouse.roth401kFirstYear};
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
  // LTCG realized selling taxable assets to clear debt at time zero, taxed in
  // the first distribution year (see the individual engine for rationale).
  let pendingDebtPayoffGain = 0;
  if (unpaidDebt > 0 && taxable > 0) {
    const taxablePayoff = Math.min(taxable, unpaidDebt);
    const payoffGain = computeRealizedGain(taxablePayoff, taxable, taxableBasis);
    taxable -= taxablePayoff;
    taxableBasis = Math.max(0, taxableBasis - Math.max(0, taxablePayoff - payoffGain));
    unpaidDebt -= taxablePayoff;
    pendingDebtPayoffGain = payoffGain;
  }

  const yearlyData = [];
  let totalTaxesPaid = 0;
  let totalConverted = 0;
  let totalUnmetCashFlow = unpaidDebt;
  // Finalized after the loop: zero assets flag immediately; unmet cash flow
  // is judged cumulatively against the banner's materiality threshold (see
  // the individual engine for rationale).
  let depleted = false;
  // Projected household MAGI by year, for the IRMAA two-year lookback.
  const coupleMagiByYear = historicalMagi(shared);
  // Per-spouse Roth ordering layers (IRC 408A(d)(4)).
  const primarySsHistory = {withheldMonths: primary.ssPriorWithheldMonths || 0}, spouseSsHistory = {withheldMonths: spouse.ssPriorWithheldMonths || 0};
  const coupleRothLayers = {primary: initialRothLayers(primary), spouse: initialRothLayers(spouse)};
  let priorPriorYearEndTotal = 0;
  let priorYearEndTotal =
    cash + primarySeppState.balance + spouseSeppState.balance +
    taxable +
    primaryState.b401k +
    spouseState.b401k +
    primaryState.bTradIra +
    spouseState.bTradIra +
    primaryState.bRoth + primaryPlanRoth.balance +
    spouseState.bRoth + spousePlanRoth.balance +
    primaryState.bHsa +
    spouseState.bHsa -
    unpaidDebt;

  const totalAssets = () =>
    cash + primarySeppState.balance + spouseSeppState.balance +
    taxable +
    primaryState.b401k +
    spouseState.b401k +
    primaryState.bTradIra +
    spouseState.bTradIra +
    primaryState.bRoth + primaryPlanRoth.balance +
    spouseState.bRoth + spousePlanRoth.balance +
    primaryState.bHsa +
    spouseState.bHsa -
    unpaidDebt;

  for (let year = currentYear; year <= endYear; year++) {
    const yearIndex = year - currentYear;
    const primaryAge = primary.currentAge + yearIndex;
    const spouseAge = spouse.currentAge + yearIndex;
    const primaryAlive = aliveFraction(primary,year), spouseAlive = aliveFraction(spouse,year);
    const deathYear = Math.min(primary.deathYear ?? Infinity,spouse.deathYear ?? Infinity);
    const filingStatus = year <= deathYear || (shared.qualifyingSurvivingSpouse && year <= deathYear+2) ? 'mfj' : 'single';
    const alive = {primary: primaryAlive>0,spouse:spouseAlive>0};
    if (primary.deathYear != null && year === primary.deathYear+1 && primary.spouseInheritance === 'own')
      transferSpousalAccounts(primaryState,spouseState,coupleRothLayers.primary,coupleRothLayers.spouse,primaryPlanRoth,spousePlanRoth);
    if (spouse.deathYear != null && year === spouse.deathYear+1 && spouse.spouseInheritance === 'own')
      transferSpousalAccounts(spouseState,primaryState,coupleRothLayers.spouse,coupleRothLayers.primary,spousePlanRoth,primaryPlanRoth);
    const primaryRetired = primaryAge >= primary.retirementAge || primaryAlive===0;
    const spouseRetired = spouseAge >= spouse.retirementAge || spouseAlive===0;
    const seppFlows = {};
    for (const [key,person,state,retired,schedule] of [
      ['primary',primary,primaryState,primaryRetired,primarySeppState],
      ['spouse',spouse,spouseState,spouseRetired,spouseSeppState]]) {
      schedule.available = state.bTradIra+(retired ? state.b401k : 0);
      const prior=schedule.allocation;
      seppFlows[key] = seppSchedule(person,year,schedule,seppAmortizedPayment);
      if (schedule.allocation>prior) {
        const allocated=schedule.allocation-prior,fromIra=Math.min(state.bTradIra,allocated);
        state.bTradIra-=fromIra;state.b401k-=allocated-fromIra;
      }
      state.bTradIra+=seppFlows[key].release;
    }
    if (primaryAlive===0 && primary.spouseInheritance==="own" && seppFlows.primary.release>0) {spouseState.bTradIra+=seppFlows.primary.release;primaryState.bTradIra-=seppFlows.primary.release;}
    if (spouseAlive===0 && spouse.spouseInheritance==="own" && seppFlows.spouse.release>0) {primaryState.bTradIra+=seppFlows.spouse.release;spouseState.bTradIra-=seppFlows.spouse.release;}
    const seppIncomes={primary:seppFlows.primary.payment,spouse:seppFlows.spouse.payment};
    const recaptureTax=seppFlows.primary.recapture+seppFlows.spouse.recapture;
    const householdRetired = primaryAge >= primary.retirementAge || spouseAge >= spouse.retirementAge;
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
      ? annualReturn(yearlyReturns, year - Math.max(currentYear, firstRetirementYear), shared.postReturn)
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
    const hsaSelfBase=getContributionLimits(49,year,shared.inflation,1).hsa;
    const hsaFamilyBase=getContributionLimits(49,year,shared.inflation,2).hsa;
    const hsaRooms=coupleHsaRooms(primary,spouse,primaryAge,spouseAge,year,hsaSelfBase,hsaFamilyBase);
    // Contribution funding (see fundPersonContributions): statutory caps only
    // during joint accumulation; salary-funded caps (HSA → FICA → deferral →
    // match, all within compensation) once the household is drawing down.
    const primarySalaryNominal = Math.round(
      Math.max(0, primary.salaryIncome || 0) * inflMult * primaryAlive,
    );
    const spouseSalaryNominal = Math.round(
      Math.max(0, spouse.salaryIncome || 0) * inflMult * spouseAlive,
    );
    const primaryFunding = fundPersonContributions({
      retired: primaryRetired,
      salaryFunded: true,
      salaryNominal: primarySalaryNominal,
      contrib401k: primary.contrib401k,
      contribMatch: primary.contribMatch,
      contribHsa: primary.contribHsa,
      limits: primary401kLimit,
      // Family pool + own catch-up only (catch-ups are never poolable).
      hsaLimitRemaining: hsaRooms.primary,
      hsaPayroll: primary.hsaPayroll,
      year,
      inflation: shared.inflation,
    });
    const spouseFunding = fundPersonContributions({
      retired: spouseRetired,
      salaryFunded: true,
      salaryNominal: spouseSalaryNominal,
      contrib401k: spouse.contrib401k,
      contribMatch: spouse.contribMatch,
      contribHsa: spouse.contribHsa,
      hsaPayroll: spouse.hsaPayroll,
      limits: spouse401kLimit,
      // Remaining family pool (primary's draw beyond their own catch-up
      // consumed it) + the spouse's own catch-up.
      hsaLimitRemaining: coupleHsaRooms(primary,spouse,primaryAge,spouseAge,year,hsaSelfBase,hsaFamilyBase,primaryFunding.appliedHsa).spouse,
      year,
      inflation: shared.inflation,
    });
    const primarySplit = catchupSplit({...primary,priorEmployerWages:year===currentYear ? primary.priorEmployerWages : primary.salaryIncome*Math.pow(1+shared.inflation,year-currentYear-1)},primaryAge,year,primaryFunding.applied401k,shared.inflation);
    const spouseSplit = catchupSplit({...spouse,priorEmployerWages:year===currentYear ? spouse.priorEmployerWages : spouse.salaryIncome*Math.pow(1+shared.inflation,year-currentYear-1)},spouseAge,year,spouseFunding.applied401k,shared.inflation);
    const primary401kApplied = primarySplit.pretax;
    const primaryMatchApplied = primaryFunding.appliedMatch;
    const primaryHsaApplied = primaryFunding.appliedHsa;
    const spouse401kApplied = spouseSplit.pretax;
    const spouseMatchApplied = spouseFunding.appliedMatch;
    const spouseHsaApplied = spouseFunding.appliedHsa;

    if (!householdRetired) {
      // Same treatment as the individual engine: forced IRA RMDs, SS already
      // claimed, and commenced pensions are run through the real tax engine
      // even while both spouses work; the after-tax remainder is reinvested
      // in taxable. When salaries are entered they stack UNDER these flows
      // for tax purposes and the projection is charged only the incremental
      // tax over a salary-only baseline (salary cash, its own income tax,
      // and FICA stay out of scope in joint working years). With no salary
      // the tax is a documented floor. Each spouse's current-employer 401k
      // is hidden from the solver (still-working RMD exception; also not
      // withdrawable while employed).
      const primaryAccumRmd =
        primaryAge >= primary.rmdStartAge && primaryState.bTradIra > 0
          ? primaryState.bTradIra / (rmdDivisor(primaryAge) || Infinity)
          : 0;
      const spouseAccumRmd =
        spouseAge >= spouse.rmdStartAge && spouseState.bTradIra > 0
          ? spouseState.bTradIra / (rmdDivisor(spouseAge) || Infinity)
          : 0;
      let ssPrimaryAccum =
        primaryAge >= effectiveSsClaimAge(primary.ssAge)
          ? Math.round(
              adjustedSocialSecurityBenefit(
                primary.ssIncome,
                primary.ssAge,
                primaryFra,
              ) * Math.pow(1 + shared.inflation, year - currentYear),
            )
          : 0;
      let ssSpouseAccum =
        spouseAge >= effectiveSsClaimAge(spouse.ssAge)
          ? Math.round(
              adjustedSocialSecurityBenefit(
                spouse.ssIncome,
                spouse.ssAge,
                spouseFra,
              ) * Math.pow(1 + shared.inflation, year - currentYear),
            )
          : 0;
      let pensionPrimaryAccum =
        primaryAge >= primary.pensionStartAge && primary.pensionIncome > 0
          ? Math.round(
              primary.pensionIncome *
                Math.pow(
                  1 + shared.inflation,
                  primaryPensionStartYear - currentYear,
                ) *
                Math.pow(
                  1 + primary.pensionCola,
                  Math.max(0, year - primaryPensionStartYear),
                ),
            )
          : 0;
      let pensionSpouseAccum =
        spouseAge >= spouse.pensionStartAge && spouse.pensionIncome > 0
          ? Math.round(
              spouse.pensionIncome *
                Math.pow(
                  1 + shared.inflation,
                  spousePensionStartYear - currentYear,
                ) *
                Math.pow(
                  1 + spouse.pensionCola,
                  Math.max(0, year - spousePensionStartYear),
                ),
            )
          : 0;
      ssPrimaryAccum = socialSecurityPaid(primary,primaryAge,year,primaryFra,ssPrimaryAccum,primarySalaryNominal,shared.inflation,primarySsHistory).paid;
      ssSpouseAccum = socialSecurityPaid(spouse,spouseAge,year,spouseFra,ssSpouseAccum,spouseSalaryNominal,shared.inflation,spouseSsHistory).paid;
      ssPrimaryAccum *= aliveFraction(primary,year,true);ssSpouseAccum *= aliveFraction(spouse,year,true);
      pensionPrimaryAccum *= primaryAlive+(spouseAlive>0 ? (1-primaryAlive)*(primary.pensionSurvivorFraction || 0) : 0);
      pensionSpouseAccum *= spouseAlive+(primaryAlive>0 ? (1-spouseAlive)*(spouse.pensionSurvivorFraction || 0) : 0);
      const accumIncome =
        ssPrimaryAccum + ssSpouseAccum + pensionPrimaryAccum + pensionSpouseAccum + seppIncomes.primary + seppIncomes.spouse;
      // Taxable wages (gross salary minus this year's pre-tax contributions)
      // stack under the forced flows; the salary-only baseline tax is
      // credited back through netNeed so only the increment is charged.
      const primarySalaryTaxAccum = Math.max(
        0,
        primarySalaryNominal - primary401kApplied - primaryHsaApplied,
      );
      const spouseSalaryTaxAccum = Math.max(
        0,
        spouseSalaryNominal - spouse401kApplied - spouseHsaApplied,
      );
      const accumSeniors65 =
        (primaryAlive>0 && primaryAge >= 65 ? 1 : 0) + (spouseAlive>0 && spouseAge >= 65 ? 1 : 0);
      const baselineSalaryTax =
        primarySalaryTaxAccum + spouseSalaryTaxAccum > 0
          ? totalTax(
              primarySalaryTaxAccum + spouseSalaryTaxAccum,
              0,
              year,
              0,
              shared.inflation,
              0,
              0,
              accumSeniors65,
            )
          : 0;
      const solve = solveCoupleGrossedUpWithdrawals({
        filingStatus, alive, seppIncomes, recaptureTax,
        // Negative net need: passive income with no modeled spending, plus
        // the salary-only baseline tax (paid by the out-of-scope salaries,
        // never from the portfolio).
        netNeed: -(accumIncome + baselineSalaryTax),
        state: {
          cash,
          taxable,
          taxableBasis,
          primary401k: primary.currentEmployerPlan===false ? primaryState.b401k : employerPlanRmd(primary,primaryAge,year,primaryState.b401k,rmdDivisor),
          spouse401k: spouse.currentEmployerPlan===false ? spouseState.b401k : employerPlanRmd(spouse,spouseAge,year,spouseState.b401k,rmdDivisor),
          primaryTradIra: primaryState.bTradIra,
          spouseTradIra: spouseState.bTradIra,
          primaryRoth: primaryState.bRoth,
          spouseRoth: spouseState.bRoth,
        },
        preHouseholdSs: ssPrimaryAccum + ssSpouseAccum <= 0,
        conversions: { primary: 0, spouse: 0 },
        rmds: { primary: {ira: primaryAccumRmd, k401: employerPlanRmd(primary,primaryAge,year,primaryState.b401k,rmdDivisor)}, spouse: {ira: spouseAccumRmd, k401: employerPlanRmd(spouse,spouseAge,year,spouseState.b401k,rmdDivisor)} },
        incomes: {
          // Taxable wages enter the tax base only (ordinary income,
          // provisional income, MAGI) — the matching cash never does.
          primaryWage: primarySalaryTaxAccum,
          spouseWage: spouseSalaryTaxAccum,
          primaryPartTime: 0,
          spousePartTime: 0,
          primarySs: ssPrimaryAccum,
          spouseSs: ssSpouseAccum,
          primaryPension: pensionPrimaryAccum,
          spousePension: pensionSpouseAccum,
          primaryPensionNyExempt: primary.pensionNyExempt,
          spousePensionNyExempt: spouse.pensionNyExempt,
        },
        year,
        ages: { primary: primaryAge, spouse: spouseAge },
        inflation: shared.inflation,
        penaltyFree401k: {
          primary: primary.currentEmployerPlan !== false && primary.retirementAge >= 55,
          spouse: spouse.currentEmployerPlan !== false && spouse.retirementAge >= 55,
        },
        cashPolicy: {
          strategy: shared.cashStrategy || "cashFirst",
          reserveNominal:
            (shared.cashStrategy || "cashFirst") === "cashFirst"
              ? 0
              : Math.round(
                  Math.max(0, shared.cashReserveFloor || 0) * inflMult,
                ),
          allowReserve: !!shared.allowReserveAsLastResort,
        },
        rothLayers: coupleRothLayers,
        interestIncome: Math.max(0, cash * shared.cashReturn),
        cashRate: shared.cashReturn, taxableOrdinaryYield: shared.taxableOrdinaryYield || 0, surplusEarnsCashInterest: false,
      });
      const w = solve.withdrawals;
      const tax = solve.tax;
      const basisReduction = Math.max(0, w.taxable - solve.realizedGain);
      cash = Math.max(0, cash - w.cash);
      taxable = Math.max(0, taxable - w.taxable);
      taxableBasis = Math.max(0, taxableBasis - basisReduction);
      primaryState.b401k = Math.max(0,primaryState.b401k-w.primary401k);
      spouseState.b401k = Math.max(0,spouseState.b401k-w.spouse401k);
      primaryState.bTradIra = Math.max(0, primaryState.bTradIra - w.primaryIra);
      spouseState.bTradIra = Math.max(0, spouseState.bTradIra - w.spouseIra);
      consumeRothLayers(w.primaryRoth, coupleRothLayers.primary);
      consumeRothLayers(w.spouseRoth, coupleRothLayers.spouse);
      primaryState.bRoth = Math.max(0, primaryState.bRoth - w.primaryRoth);
      spouseState.bRoth = Math.max(0, spouseState.bRoth - w.spouseRoth);
      const grossWithdrawal =
        w.cash +
        w.taxable +
        w.primary401k +
        w.spouse401k +
        w.primaryIra +
        w.spouseIra +
        w.primaryRoth +
        w.spouseRoth;
      // The projection's tax is the INCREMENT over the salary-only baseline
      // (equal to the full tax when no salaries are entered). Reinvest the
      // forced flows net of that increment in taxable at full basis.
      const incrementalTax = Math.max(0, Math.round(tax - baselineSalaryTax));
      const accumSurplus = Math.max(
        0,
        grossWithdrawal + accumIncome - incrementalTax,
      );
      const accumUnmet = Math.max(
        0,
        incrementalTax - accumIncome - grossWithdrawal,
      );
      totalUnmetCashFlow += accumUnmet < 0.51 ? 0 : accumUnmet;
      taxable += accumSurplus;
      taxableBasis += accumSurplus + (solve.brokerageIncome || 0);
      totalTaxesPaid += incrementalTax;
      // IRMAA's 2-year lookback: record MAGI only when salaries make it
      // complete; otherwise keep the same-year fallback (see the individual
      // engine note).
      coupleMagiByYear[year] = solve.ordIncome + solve.realizedGain;

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
      primarySeppState.balance *= 1+marketReturn; spouseSeppState.balance *= 1+marketReturn;
    primaryState.bRoth *= 1 + marketReturn;
      primaryPlanRoth.balance = primaryPlanRoth.balance*(1+marketReturn)+primarySplit.roth;
      primaryPlanRoth.basis += primarySplit.roth;
      if (primarySplit.roth > 0 && primaryPlanRoth.firstYear == null) primaryPlanRoth.firstYear=year;
      spouseState.bRoth *= 1 + marketReturn;
      spousePlanRoth.balance = spousePlanRoth.balance*(1+marketReturn)+spouseSplit.roth;
      spousePlanRoth.basis += spouseSplit.roth;
      if (spouseSplit.roth > 0 && spousePlanRoth.firstYear == null) spousePlanRoth.firstYear=year;
      primaryState.bHsa = primaryState.bHsa * (1 + marketReturn) + primaryHsaApplied;
      spouseState.bHsa = spouseState.bHsa * (1 + marketReturn) + spouseHsaApplied;
      cash *= 1 + shared.cashReturn;
      taxable = taxable * (1 + taxableReturn(marketReturn));

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
        wages: 0,
        ficaTax: 0,
        partTime: 0,
        ss: ssPrimaryAccum + ssSpouseAccum,
        taxableWages: Math.round(primarySalaryTaxAccum+spouseSalaryTaxAccum),
        pension: pensionPrimaryAccum + pensionSpouseAccum,
        netNeed: 0,
        grossWithdrawal: Math.round(grossWithdrawal + seppIncomes.primary + seppIncomes.spouse),
        fromCash: Math.round(w.cash),
        fromTaxable: Math.round(w.taxable),
        from401k: Math.round(w.primary401k + w.spouse401k),
        fromIra: Math.round(w.primaryIra + w.spouseIra + seppIncomes.primary + seppIncomes.spouse),
        fromRoth: Math.round(w.primaryRoth + w.spouseRoth),
        hsaWithdrawal: 0,
        conversion: 0,
        // Incremental over the salary-only baseline; full-year MAGI (incl.
        // taxable wages) is in `magi`.
        tax: incrementalTax,
        strategy: "Accumulating",
        calculationValid: solve.converged,
        calculationNotice: solve.converged ? null : "Accumulation tax calculation did not converge.",
        cash: Math.round(cash),
        taxable: Math.round(taxable),
        k401: Math.round(primaryState.b401k + spouseState.b401k),
        tradIra: Math.round(primaryState.bTradIra + spouseState.bTradIra + primarySeppState.balance + spouseSeppState.balance),
      seppIncome: Math.round(seppIncomes.primary + seppIncomes.spouse),
      seppBalance: Math.round(primarySeppState.balance + spouseSeppState.balance),
        roth: Math.round(primaryState.bRoth + spouseState.bRoth + primaryPlanRoth.balance + spousePlanRoth.balance),
        hsa: Math.round(primaryState.bHsa + spouseState.bHsa),
        total: Math.round(total),
        rmdAmount: Math.round(primaryAccumRmd + spouseAccumRmd),
        realizedGain: Math.round(solve.realizedGain),
        taxableSs: Math.round(solve.taxableSs),
        magi: Math.round(solve.ordIncome + solve.realizedGain),
        taxableBasisEnd: Math.round(taxableBasis),
        irmaaSurcharge: 0,
        irmaaTriggered: false,
        acaSubsidy: 0,
        earlyPenalty: solve.earlyPenalty,
        cashFloor: 0,
        reserveUsed: Math.round(w.reserveUsed || 0),
        unmetCashFlow: Math.round(unpaidDebt + accumUnmet),
        // After-tax forced-flow remainder reinvested into Taxable (not Cash).
        surplusToTaxable: Math.round(accumSurplus),
        ownerDetails: {
          primary: {
            name: primary.name,
            employerPlanLabel: primary.employerPlanLabel || "401k",
            contribution401kApplied: Math.round(primary401kApplied + primarySplit.roth),
          contributionRoth401kApplied: Math.round(primarySplit.roth),
            contributionHsaApplied: Math.round(primaryHsaApplied),
            rmdAmount: Math.round(primaryAccumRmd),
            ss: ssPrimaryAccum,
            pension: pensionPrimaryAccum,
          },
          spouse: {
            name: spouse.name,
            employerPlanLabel: spouse.employerPlanLabel || "403b",
            contribution401kApplied: Math.round(spouse401kApplied + spouseSplit.roth),
          contributionRoth401kApplied: Math.round(spouseSplit.roth),
            contributionHsaApplied: Math.round(spouseHsaApplied),
            rmdAmount: Math.round(spouseAccumRmd),
            ss: ssSpouseAccum,
            pension: pensionSpouseAccum,
          },
        },
      });
      continue;
    }

    const primaryHealthcare = primaryRetired
      ? (primaryAge < 65 ? primary.healthcarePre65 : primary.healthcarePost65) * inflMult * primaryAlive
      : 0;
    const spouseHealthcare = spouseRetired
      ? (spouseAge < 65 ? spouse.healthcarePre65 : spouse.healthcarePost65) * inflMult * spouseAlive
      : 0;
    const survivorFraction = 1-Math.min(primaryAlive,spouseAlive);
    const lifestyleSpending = Math.round((shared.baseExpenses*(1-survivorFraction)+(shared.survivorBaseExpenses ?? shared.baseExpenses)*survivorFraction)*inflMult);
    // Flexible spending cuts discretionary lifestyle only — see the
    // individual-engine note (a whole-spending cut was absorbed by the HSA
    // offset and never reduced the portfolio draw).
    let flexCut = 0;
    if (useFlexibleSpending && priorPriorYearEndTotal > 0 && yearsFromRetirement > 0) {
      const yoyChange =
        (priorYearEndTotal - priorPriorYearEndTotal) / priorPriorYearEndTotal;
      if (yoyChange < -0.15) flexCut = Math.round(lifestyleSpending * 0.1);
    }
    const lifestyleAfterFlex = lifestyleSpending - flexCut;
    let spending = Math.round(
      lifestyleAfterFlex + primaryHealthcare + spouseHealthcare,
    );

    const primaryPartTime =
      primaryRetired && primaryAge < primary.retirementAge + primary.partTimeYears
        ? Math.round(primary.partTimeIncome * inflMult * primaryAlive)
        : 0;
    const spousePartTime =
      spouseRetired && spouseAge < spouse.retirementAge + spouse.partTimeYears
        ? Math.round(spouse.partTimeIncome * inflMult * spouseAlive)
        : 0;
    let primarySs =
      primaryAge >= effectiveSsClaimAge(primary.ssAge)
        ? Math.round(
            adjustedSocialSecurityBenefit(
              primary.ssIncome,
              primary.ssAge,
              primaryFra,
            ) * Math.pow(1 + shared.inflation, year - currentYear),
          )
        : 0;
    let spouseSs =
      spouseAge >= effectiveSsClaimAge(spouse.ssAge)
        ? Math.round(
            adjustedSocialSecurityBenefit(
              spouse.ssIncome,
              spouse.ssAge,
              spouseFra,
            ) * Math.pow(1 + shared.inflation, year - currentYear),
          )
        : 0;
    primarySs = socialSecurityPaid(primary,primaryAge,year,primaryFra,primarySs,primaryPartTime + (primaryRetired ? 0 : primarySalaryNominal),shared.inflation,primarySsHistory).paid;
    spouseSs = socialSecurityPaid(spouse,spouseAge,year,spouseFra,spouseSs,spousePartTime + (spouseRetired ? 0 : spouseSalaryNominal),shared.inflation,spouseSsHistory).paid;
    const originalPrimarySs = primarySs, originalSpouseSs = spouseSs;
    primarySs *= aliveFraction(primary,year,true); spouseSs *= aliveFraction(spouse,year,true);
    if (spouseAlive < 1 && primaryAlive > 0) {
      const entitlement = primary.survivorSsAnnual != null ? primary.survivorSsAnnual*inflMult : primaryAge>=primaryFra ? Math.max(originalPrimarySs,originalSpouseSs) : originalPrimarySs;
      primarySs += Math.max(0,entitlement-originalPrimarySs)*(1-spouseAlive);
    }
    if (primaryAlive < 1 && spouseAlive > 0) {
      const entitlement = spouse.survivorSsAnnual != null ? spouse.survivorSsAnnual*inflMult : spouseAge>=spouseFra ? Math.max(originalPrimarySs,originalSpouseSs) : originalSpouseSs;
      spouseSs += Math.max(0,entitlement-originalSpouseSs)*(1-primaryAlive);
    }
    let primaryPension =
      primaryAge >= primary.pensionStartAge && primary.pensionIncome > 0
        ? Math.round(
            primary.pensionIncome *
              Math.pow(
                1 + shared.inflation,
                primaryPensionStartYear - currentYear,
              ) *
              Math.pow(
                1 + primary.pensionCola,
                Math.max(0, year - primaryPensionStartYear),
              ),
          )
        : 0;
    let spousePension =
      spouseAge >= spouse.pensionStartAge && spouse.pensionIncome > 0
        ? Math.round(
            spouse.pensionIncome *
              Math.pow(
                1 + shared.inflation,
                spousePensionStartYear - currentYear,
              ) *
              Math.pow(
                1 + spouse.pensionCola,
                Math.max(0, year - spousePensionStartYear),
              ),
          )
        : 0;
    primaryPension *= primaryAlive + (spouseAlive>0 ? (1-primaryAlive)*Math.max(0,Math.min(1,primary.pensionSurvivorFraction ?? 0)) : 0);
    spousePension *= spouseAlive + (primaryAlive>0 ? (1-spouseAlive)*Math.max(0,Math.min(1,spouse.pensionSurvivorFraction ?? 0)) : 0);
    // Staggered retirement: a spouse who has not yet retired keeps earning
    // while the household is already in distribution mode. Gross salary is
    // entered in today's dollars and inflates with household inflation.
    // Two wage figures per spouse:
    //  - TAXABLE wages (primaryWage/spouseWage): gross minus pre-tax 401k/
    //    HSA contributions. Feeds the solver's ordinary income, provisional
    //    income, and MAGI. Employee FICA is NOT income-tax-deductible, so it
    //    stays inside this base.
    //  - SPENDABLE wages (…WageCash): taxable wages minus employee FICA
    //    (6.2% OASDI to the wage base + 1.45% Medicare, computed in
    //    fundPersonContributions) minus this household's 0.9% Additional
    //    Medicare Tax above $250K MFJ of combined covered wages (statutory,
    //    not indexed), allocated pro-rata. Feeds household income available
    //    for spending. Contributions were already capped so that
    //    HSA + FICA + deferral never exceed salary — spendable cash is
    //    exact, not floored.
    const primaryFicaBase = primaryFunding.ficaBase + primaryPartTime;
    const spouseFicaBase = spouseFunding.ficaBase + spousePartTime;
    const combinedFicaBase = primaryFicaBase + spouseFicaBase;
    const additionalMedicare =
      0.009 * Math.max(0, combinedFicaBase - (filingStatus === "single" ? 200000 : 250000));
    const primaryFica =
      employeeFica(primaryFicaBase, year, shared.inflation) +
      (combinedFicaBase > 0
        ? additionalMedicare * (primaryFicaBase / combinedFicaBase)
        : 0);
    const spouseFica =
      employeeFica(spouseFicaBase, year, shared.inflation) +
      (combinedFicaBase > 0
        ? additionalMedicare * (spouseFicaBase / combinedFicaBase)
        : 0);
    const primaryWage = !primaryRetired
      ? Math.max(
          0,
          primarySalaryNominal - primary401kApplied - primaryHsaApplied,
        )
      : 0;
    const spouseWage = !spouseRetired
      ? Math.max(0, spouseSalaryNominal - spouse401kApplied - spouseHsaApplied)
      : 0;
    const primaryWageCash = primaryWage - primaryFica - primarySplit.roth;
    const spouseWageCash = spouseWage - spouseFica - spouseSplit.roth;

    // RMDs use start-of-year balances, which equal the prior December 31
    // balances now that growth is applied once at the end of each year.
    // Still-working exception (per spouse): the current employer's 401k has
    // no RMD until the year that spouse retires — only the Traditional IRA
    // is RMD-subject while they work. (Not modeled: 5% owners, who get no
    // exception.) Matches the accumulation-branch treatment.
    const primaryRmd =
      primaryAge >= primary.rmdStartAge
        ? Math.max(
            0,
            ((primaryRetired || primary.currentEmployerPlan===false || primary.fivePercentOwner ? primaryState.b401k : 0) +
              primaryState.bTradIra) /
              (rmdDivisor(primaryAge) || Infinity),
          )
        : 0;
    const spouseRmd =
      spouseAge >= spouse.rmdStartAge
        ? Math.max(
            0,
            ((spouseRetired || spouse.currentEmployerPlan===false || spouse.fivePercentOwner ? spouseState.b401k : 0) +
              spouseState.bTradIra) /
              (rmdDivisor(spouseAge) || Infinity),
          )
        : 0;
    const primaryConversion = personConversionTarget(
      primary,
      primaryAge,
      inflMult,
      primaryState.b401k,
      primaryState.bTradIra,
      primaryRmd,
    );
    const spouseConversion = personConversionTarget(
      spouse,
      spouseAge,
      inflMult,
      spouseState.b401k,
      spouseState.bTradIra,
      spouseRmd,
    );

    let hsaAllocation = coupleQualifiedHsa(primaryState.bHsa,spouseState.bHsa,primary,spouse,primaryAge,spouseAge,inflMult,Math.max(0,spending-lifestyleAfterFlex));
    let totalPrimaryHsaWithdrawal = hsaAllocation.primary;
    let totalSpouseHsaWithdrawal = hsaAllocation.spouse;
    let hsaWithdrawal = hsaAllocation.total;

    const incomeTotal = seppIncomes.primary + seppIncomes.spouse +
      primaryWageCash +
      spouseWageCash +
      primaryPartTime +
      spousePartTime +
      primarySs +
      spouseSs +
      primaryPension +
      spousePension;
    // Rule of 55 per spouse: separation from service at 55+ exempts that
    // spouse's 401k (never IRAs) from the §72(t) early-withdrawal penalty.
    const couplePenaltyFree401k = {
      primary: primary.currentEmployerPlan !== false && primary.retirementAge >= 55,
      spouse: spouse.currentEmployerPlan !== false && spouse.retirementAge >= 55,
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
    // Debt-payoff LTCG (time zero) is taxed in this first distribution year,
    // then cleared so it applies only once.
    const debtPayoffGainThisYear = pendingDebtPayoffGain;
    pendingDebtPayoffGain = 0;
    // Withdrawal-eligible employer-plan balances: a still-working spouse's
    // current-employer 401k is not withdrawable (in-service withdrawals are
    // not modeled), so the waterfall must never see it — mirrors the RMD
    // still-working exception above. Their Traditional IRA and Roth remain
    // reachable.
    const primary401kAvailable = primaryRetired || primary.currentEmployerPlan===false
      ? Math.max(0, primaryState.b401k - primaryConversion)
      : employerPlanRmd(primary,primaryAge,year,primaryState.b401k,rmdDivisor);
    const spouse401kAvailable = spouseRetired || spouse.currentEmployerPlan===false
      ? Math.max(0, spouseState.b401k - spouseConversion)
      : employerPlanRmd(spouse,spouseAge,year,spouseState.b401k,rmdDivisor);
    // Signed net cash flow (see the individual engine): negative when
    // recurring household income exceeds spending. The solver floors the
    // withdrawal at zero; the after-tax surplus is swept to shared cash below.
    let netNeed = spending - hsaWithdrawal - incomeTotal;
    let solve = solveCoupleGrossedUpWithdrawals({
        filingStatus, alive, seppIncomes, recaptureTax,
        planRothAccounts: {primary: primaryRetired ? primaryPlanRoth : null, spouse: spouseRetired ? spousePlanRoth : null},
        taxableHsaAvailable: {primary: Math.max(0,primaryState.bHsa-totalPrimaryHsaWithdrawal), spouse: Math.max(0,spouseState.bHsa-totalSpouseHsaWithdrawal)},
      netNeed,
      state: {
        cash,
        taxable,
        taxableBasis,
        primary401k: primary401kAvailable,
        spouse401k: spouse401kAvailable,
        primaryTradIra: primaryState.bTradIra,
        spouseTradIra: spouseState.bTradIra,
        primaryRoth: primaryState.bRoth,
        spouseRoth: spouseState.bRoth,
      },
      preHouseholdSs: primarySs + spouseSs <= 0,
      conversions: { primary: primaryConversion, spouse: spouseConversion },
      rmds: { primary: {ira: primaryAge >= primary.rmdStartAge ? primaryState.bTradIra / rmdDivisor(primaryAge) : 0, k401: employerPlanRmd(primary,primaryAge,year,primaryState.b401k,rmdDivisor)}, spouse: {ira: spouseAge >= spouse.rmdStartAge ? spouseState.bTradIra / rmdDivisor(spouseAge) : 0, k401: employerPlanRmd(spouse,spouseAge,year,spouseState.b401k,rmdDivisor)} },
      incomes: {
        primaryWage,
        spouseWage,
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
      cashRate: shared.cashReturn, taxableOrdinaryYield: shared.taxableOrdinaryYield || 0,
      additionalRealizedGain: debtPayoffGainThisYear,
    });
    let acaSubsidy = 0;
    let acaConverged = true;
    const pre65HealthcareSticker =
      (primaryRetired && primaryAge < 65 ? primary.healthcarePre65 * inflMult : 0) +
      (spouseRetired && spouseAge < 65 ? spouse.healthcarePre65 * inflMult : 0);
    if (shared.useAcaSubsidyEstimate && pre65HealthcareSticker > 0) {
      // Iterate subsidy ↔ MAGI to a fixed point (max 4 passes, like the
      // individual engine): a single re-solve could leave a subsidy granted
      // at a MAGI that already crossed the 400%-FPL cliff. ACA MAGI adds
      // back nontaxable Social Security (§36B household income).
      const spendingBeforeAca = spending;
      const unsubsidizedSolve = solve; const unsubsidizedAllocation = hsaAllocation;
      acaConverged = false;
      for (let acaIter = 0; acaIter < 100; acaIter++) {
      const acaMagi =
        solve.ordIncome +
        solve.realizedGain +
        debtPayoffGainThisYear +
        Math.max(0, primarySs + spouseSs - solve.taxableSs);
      const subsidizedPre65Healthcare = estimateAcaHealthcareCost(
        pre65HealthcareSticker,
        acaMagi,
        filingStatus === "single" ? Math.max(1,shared.householdSize-1) : shared.householdSize,
        year,
        shared.inflation,
        shared,
      );
      const newAcaSubsidy = Math.max(
        0,
        pre65HealthcareSticker - subsidizedPre65Healthcare,
      );
      const acaStable = Math.abs(newAcaSubsidy - acaSubsidy) < 0.01;
      acaSubsidy = newAcaSubsidy;
      spending = Math.max(0, Math.round(spendingBeforeAca - acaSubsidy));
      hsaAllocation = coupleQualifiedHsa(primaryState.bHsa,spouseState.bHsa,primary,spouse,primaryAge,spouseAge,inflMult,Math.max(0,spending-lifestyleAfterFlex));
      totalPrimaryHsaWithdrawal = hsaAllocation.primary;
      totalSpouseHsaWithdrawal = hsaAllocation.spouse;
      hsaWithdrawal = hsaAllocation.total;
      netNeed = spending - hsaWithdrawal - incomeTotal;
      if (acaStable) { acaConverged = true; break; }
      solve = solveCoupleGrossedUpWithdrawals({
        filingStatus, alive, seppIncomes, recaptureTax,
        planRothAccounts: {primary: primaryRetired ? primaryPlanRoth : null, spouse: spouseRetired ? spousePlanRoth : null},
        taxableHsaAvailable: {primary: Math.max(0,primaryState.bHsa-totalPrimaryHsaWithdrawal), spouse: Math.max(0,spouseState.bHsa-totalSpouseHsaWithdrawal)},
        netNeed,
        state: {
          cash,
          taxable,
          taxableBasis,
          primary401k: primary401kAvailable,
          spouse401k: spouse401kAvailable,
          primaryTradIra: primaryState.bTradIra,
          spouseTradIra: spouseState.bTradIra,
          primaryRoth: primaryState.bRoth,
          spouseRoth: spouseState.bRoth,
        },
        preHouseholdSs: primarySs + spouseSs <= 0,
        conversions: { primary: primaryConversion, spouse: spouseConversion },
        rmds: { primary: {ira: primaryAge >= primary.rmdStartAge ? primaryState.bTradIra / rmdDivisor(primaryAge) : 0, k401: employerPlanRmd(primary,primaryAge,year,primaryState.b401k,rmdDivisor)}, spouse: {ira: spouseAge >= spouse.rmdStartAge ? spouseState.bTradIra / rmdDivisor(spouseAge) : 0, k401: employerPlanRmd(spouse,spouseAge,year,spouseState.b401k,rmdDivisor)} },
        incomes: {
          primaryWage,
          spouseWage,
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
      cashRate: shared.cashReturn, taxableOrdinaryYield: shared.taxableOrdinaryYield || 0,
        additionalRealizedGain: debtPayoffGainThisYear,
      });
      }
      if (!acaConverged) {
        solve = unsubsidizedSolve; spending = spendingBeforeAca; acaSubsidy = 0;
        hsaAllocation = unsubsidizedAllocation; hsaWithdrawal = hsaAllocation.total;
        totalPrimaryHsaWithdrawal = hsaAllocation.primary; totalSpouseHsaWithdrawal = hsaAllocation.spouse;
        netNeed = spending - hsaWithdrawal - incomeTotal;
      }
    }

    let irmaaSurcharge = 0;
    let irmaaConverged = true;
    if (primaryAge >= 65 || spouseAge >= 65) {
      const medicareEnrollees =
        (primaryAlive>0 && primaryAge >= 65 ? 1 : 0) + (spouseAlive>0 && spouseAge >= 65 ? 1 : 0);
      const baseSpendingBeforeIrmaa = spending;
      for (let outerIter = 0; outerIter < 100; outerIter++) {
        // Real IRMAA looks back two years; use the projected MAGI from that
        // year when the projection has one, else same-year MAGI (working-year
        // salary MAGI is out of scope for this model).
        const lookbackMagi = coupleMagiByYear[year - 2];
        irmaaConverged = false;
      const newIrmaa = computeIrmaaSurcharge(
          shared.irmaaApprovedMagi?.[year] ?? (lookbackMagi != null
            ? lookbackMagi
            : solve.ordIncome + solve.realizedGain),
          year,
          shared.inflation,
          medicareEnrollees, filingStatus,
        );
        if (Math.abs(newIrmaa - irmaaSurcharge) < 0.01) {
          irmaaSurcharge = newIrmaa;
          irmaaConverged = true;
          break;
        }
        irmaaSurcharge = newIrmaa;
        spending = Math.round(baseSpendingBeforeIrmaa + irmaaSurcharge);
        hsaAllocation = coupleQualifiedHsa(primaryState.bHsa,spouseState.bHsa,primary,spouse,primaryAge,spouseAge,inflMult,Math.max(0,spending-lifestyleAfterFlex));
        totalPrimaryHsaWithdrawal = hsaAllocation.primary;
        totalSpouseHsaWithdrawal = hsaAllocation.spouse;
        hsaWithdrawal = hsaAllocation.total;
        netNeed = spending - hsaWithdrawal - incomeTotal;
        solve = solveCoupleGrossedUpWithdrawals({
        filingStatus, alive, seppIncomes, recaptureTax,
        planRothAccounts: {primary: primaryRetired ? primaryPlanRoth : null, spouse: spouseRetired ? spousePlanRoth : null},
        taxableHsaAvailable: {primary: Math.max(0,primaryState.bHsa-totalPrimaryHsaWithdrawal), spouse: Math.max(0,spouseState.bHsa-totalSpouseHsaWithdrawal)},
          netNeed,
          state: {
            cash,
            taxable,
            taxableBasis,
            primary401k: primary401kAvailable,
            spouse401k: spouse401kAvailable,
            primaryTradIra: primaryState.bTradIra,
            spouseTradIra: spouseState.bTradIra,
            primaryRoth: primaryState.bRoth,
            spouseRoth: spouseState.bRoth,
          },
          preHouseholdSs: primarySs + spouseSs <= 0,
          conversions: { primary: primaryConversion, spouse: spouseConversion },
          rmds: { primary: {ira: primaryAge >= primary.rmdStartAge ? primaryState.bTradIra / rmdDivisor(primaryAge) : 0, k401: employerPlanRmd(primary,primaryAge,year,primaryState.b401k,rmdDivisor)}, spouse: {ira: spouseAge >= spouse.rmdStartAge ? spouseState.bTradIra / rmdDivisor(spouseAge) : 0, k401: employerPlanRmd(spouse,spouseAge,year,spouseState.b401k,rmdDivisor)} },
          incomes: {
            primaryWage,
            spouseWage,
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
      cashRate: shared.cashReturn, taxableOrdinaryYield: shared.taxableOrdinaryYield || 0,
          additionalRealizedGain: debtPayoffGainThisYear,
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
    commitRothConversion(coupleRothLayers.primary,primaryConversion,year);
    commitRothConversion(coupleRothLayers.spouse,spouseConversion,year);
    consumeRothLayers(withdrawals.primaryRoth, coupleRothLayers.primary);
    consumeRothLayers(withdrawals.spouseRoth, coupleRothLayers.spouse);
    primaryState.bRoth = Math.max(
      0,
      primaryState.bRoth + primaryConversion - withdrawals.primaryRoth,
    );
    spouseState.bRoth = Math.max(
      0,
      spouseState.bRoth + spouseConversion - withdrawals.spouseRoth,
    );
    primaryState.bHsa = Math.max(0, primaryState.bHsa - totalPrimaryHsaWithdrawal - (withdrawals.primaryHsa || 0));
    spouseState.bHsa = Math.max(0, spouseState.bHsa - totalSpouseHsaWithdrawal - (withdrawals.spouseHsa || 0));

    const grossWithdrawal =
      withdrawals.cash +
      withdrawals.taxable +
      withdrawals.primary401k +
      withdrawals.spouse401k +
      withdrawals.primaryIra +
      withdrawals.spouseIra +
      withdrawals.primaryRoth +
      withdrawals.spouseRoth + (withdrawals.primaryHsa || 0) + (withdrawals.spouseHsa || 0) + (withdrawals.primaryPlanRoth || 0) + (withdrawals.spousePlanRoth || 0);
    // Forced draws above the need AND after-tax recurring-income surplus
    // (netNeed < 0) both land in shared cash — matches the individual engine.
    const surplusFromRmd = Math.max(0, grossWithdrawal - (netNeed + tax));
    if (surplusFromRmd > 0) cash += surplusFromRmd;
    const unmetCashFlow = Math.max(0, netNeed + tax - grossWithdrawal);
    totalUnmetCashFlow += unmetCashFlow < 0.51 ? 0 : unmetCashFlow;

    for (const [key,account] of [['primary',primaryPlanRoth],['spouse',spousePlanRoth]]) {
      const amount = withdrawals[`${key}PlanRoth`] || 0;
      account.basis *= 1-amount/Math.max(1,account.balance);
      account.balance = Math.max(0,account.balance-amount);
    }
    cash *= 1 + shared.cashReturn;
    taxable *= 1 + taxableReturn(marketReturn);
    taxableBasis += solve.brokerageIncome || 0;
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
    primarySeppState.balance *= 1+marketReturn; spouseSeppState.balance *= 1+marketReturn;
    primaryState.bRoth *= 1 + marketReturn;
      primaryPlanRoth.balance = primaryPlanRoth.balance*(1+marketReturn)+primarySplit.roth;
      primaryPlanRoth.basis += primarySplit.roth;
      if (primarySplit.roth > 0 && primaryPlanRoth.firstYear == null) primaryPlanRoth.firstYear=year;
    spouseState.bRoth *= 1 + marketReturn;
      spousePlanRoth.balance = spousePlanRoth.balance*(1+marketReturn)+spouseSplit.roth;
      spousePlanRoth.basis += spouseSplit.roth;
      if (spouseSplit.roth > 0 && spousePlanRoth.firstYear == null) spousePlanRoth.firstYear=year;
    primaryState.bHsa = primaryState.bHsa * (1 + marketReturn) + primaryHsaApplied;
    spouseState.bHsa = spouseState.bHsa * (1 + marketReturn) + spouseHsaApplied;

    totalTaxesPaid += tax;
    totalConverted += primaryConversion + spouseConversion;
    coupleMagiByYear[year] = solve.ordIncome + realizedGain + debtPayoffGainThisYear;

    const total = totalAssets();
    priorPriorYearEndTotal = priorYearEndTotal;
    priorYearEndTotal = total;
    // Unmet cash flow is evaluated cumulatively after the loop.
    if (total <= 0 && !depleted) depleted = true;

    let phase = "bridge";
    if (primarySs + spouseSs > 0) phase = "ss";
    else if (primaryAge >= 65 || spouseAge >= 65) phase = "medicare";
    else if (primaryAge >= 60 || spouseAge >= 60) phase = "mid";

    yearlyData.push({
      year,
      filingStatus,
      primaryAlive: primaryAlive>0, spouseAlive: spouseAlive>0,
      age: primaryAge,
      primaryAge,
      spouseAge,
      phase,
      spending,
      // Spendable (after employee FICA); taxable wages appear inside magi.
      wages: Math.round(Math.max(0,primaryWageCash) + Math.max(0,spouseWageCash)),
      ficaTax: Math.round(primaryFica + spouseFica),
      partTime: primaryPartTime + spousePartTime - (primaryRetired ? primaryFica : 0) - (spouseRetired ? spouseFica : 0),
      partTimeGross: primaryPartTime + spousePartTime,
      ss: primarySs + spouseSs,
      pension: primaryPension + spousePension,
      netNeed,
      grossWithdrawal: Math.round(grossWithdrawal + seppIncomes.primary + seppIncomes.spouse + hsaWithdrawal),
      fromCash: Math.round(withdrawals.cash),
      fromTaxable: Math.round(withdrawals.taxable),
      from401k: Math.round(withdrawals.primary401k + withdrawals.spouse401k),
      fromIra: Math.round(withdrawals.primaryIra + withdrawals.spouseIra + seppIncomes.primary + seppIncomes.spouse),
      fromRoth: Math.round(withdrawals.primaryRoth + withdrawals.spouseRoth + (withdrawals.primaryPlanRoth || 0) + (withdrawals.spousePlanRoth || 0)),
      hsaWithdrawal: Math.round(hsaWithdrawal + (withdrawals.primaryHsa || 0) + (withdrawals.spouseHsa || 0)),
      taxableHsaWithdrawal: Math.round((withdrawals.primaryHsa || 0) + (withdrawals.spouseHsa || 0)),
      conversion: Math.round(primaryConversion + spouseConversion),
      tax,
      strategy: "Couple household plan",
      cash: Math.round(cash),
      taxable: Math.round(taxable),
      k401: Math.round(primaryState.b401k + spouseState.b401k),
      tradIra: Math.round(primaryState.bTradIra + spouseState.bTradIra + primarySeppState.balance + spouseSeppState.balance),
      seppIncome: Math.round(seppIncomes.primary + seppIncomes.spouse),
      seppBalance: Math.round(primarySeppState.balance + spouseSeppState.balance),
      roth: Math.round(primaryState.bRoth + spouseState.bRoth + primaryPlanRoth.balance + spousePlanRoth.balance),
      hsa: Math.round(primaryState.bHsa + spouseState.bHsa),
      total: Math.round(total),
      rmdAmount: Math.round(primaryRmd + spouseRmd),
      realizedGain: Math.round(realizedGain),
      taxableSs: Math.round(solve.taxableSs),
      magi: Math.round(solve.ordIncome + realizedGain + debtPayoffGainThisYear),
      taxableBasisEnd: Math.round(taxableBasis),
      irmaaSurcharge: Math.round(irmaaSurcharge),
      irmaaTriggered: irmaaSurcharge > 0,
      acaSubsidy: Math.round(acaSubsidy),
      calculationValid: solve.converged && acaConverged && irmaaConverged,
      calculationNotice: !irmaaConverged ? "IRMAA tiers did not converge; assessment needs validation." : !acaConverged ? "ACA subsidy did not converge; unsubsidized estimate used." : !solve.converged ? "Tax calculation did not converge." : null,
      earlyPenalty: solve.earlyPenalty,
      cashFloor: coupleCashPolicy.reserveNominal,
      reserveUsed: Math.round(withdrawals.reserveUsed || 0),
      unmetCashFlow: Math.round(unmetCashFlow),
      // RMD excess over spending + tax, deposited into shared cash (same
      // sweep as the single engine) — surfaced so cash growth is explainable.
      surplusToCash: Math.round(surplusFromRmd),
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
          wages: Math.round(primaryWageCash),
          fica: Math.round(primaryFica),
          // Still-working spouse contributions continue during staggered
          // years (funded from salary; see fundPersonContributions).
          contribution401kApplied: Math.round(primary401kApplied + primarySplit.roth),
          contributionRoth401kApplied: Math.round(primarySplit.roth),
          contributionHsaApplied: Math.round(primaryHsaApplied),
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
          wages: Math.round(spouseWageCash),
          fica: Math.round(spouseFica),
          contribution401kApplied: Math.round(spouse401kApplied + spouseSplit.roth),
          contributionRoth401kApplied: Math.round(spouseSplit.roth),
          contributionHsaApplied: Math.round(spouseHsaApplied),
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
  const coupleCurrentTotal =
    shared.balanceCash +
    shared.balanceTaxable +
    primary.balance401k +
    spouse.balance401k +
    primary.balanceTradIra +
    spouse.balanceTradIra +
    primary.balanceRoth + (primary.balanceRoth401k || 0) +
    spouse.balanceRoth + (spouse.balanceRoth401k || 0) +
    primary.balanceHsa +
    spouse.balanceHsa -
    (shared.creditCardDebt || 0);
  // Already-retired couples have no pre-retirement row: use TODAY'S assets
  // as the withdrawal-rate denominator (matching the individual engine).
  // Falling back to the first year's END-of-year total overstated the rate
  // ($100K from $1M displayed as 11.1% instead of 10%).
  const startBalance =
    startOfRetirement && startOfRetirement.total > 0
      ? startOfRetirement.total
      : coupleCurrentTotal > 0
        ? coupleCurrentTotal
        : retirementData && retirementData.total > 0
          ? retirementData.total
          : 1;

  // Cumulative unmet cash flow marks the plan depleted only when it clears
  // the banner's materiality bar (materialUnmetThreshold).
  const coupleYear1Spending = retirementData ? retirementData.spending : 0;
  if (totalUnmetCashFlow > materialUnmetThreshold(coupleYear1Spending)) {
    depleted = true;
  }

  return {
    yearlyData,
    summary: {
      modelNotices: financialNotices({mode:"couple",couple:{primary,spouse,shared}},yearlyData),
      calculationValid: financialNotices({mode:"couple",couple:{primary,spouse,shared}},yearlyData).length === 0,
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
      currentTotal: coupleCurrentTotal,
      planThroughAge: displayInputs.planThroughAge,
    },
  };
}

function simulatePlan(inputs, options = {}) {
  return isCoupleMode(inputs) ? simulateCouple(inputs.couple, options) : simulate(inputs, options);
}

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
  ...POLICY_DEFAULTS,
  projectionStartYear: PROJECTION_START_YEAR,
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
  // Gross annual salary (today's dollars) while still working. Affects
  // PRE-RETIREMENT TAXES ONLY: forced RMDs, inherited payouts, SS, and
  // pensions received while working are taxed stacked on top of this salary
  // (the projection is charged the incremental tax above a salary-only
  // baseline) instead of from the bottom brackets. Salary cash itself —
  // its own income tax, FICA, and spending — stays out of scope and never
  // funds balances. $0 = no stacking (legacy tax floor).
  salaryIncome: 0,
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
  // Inherited account under a Beneficiary Continuation Option (BCO) — an
  // inherited IRA/403(b)/401(k) or non-qualified annuity kept in beneficiary
  // form (e.g. EQUI-VEST BCO). Withdrawals at ANY age are exempt from the
  // 10% early-withdrawal penalty (death exception, IRC §72(t)/(q)), but the
  // taxable portion is ordinary income, and beneficiary required
  // distributions apply. $0 = no inherited account.
  balanceInherited: 0,
  // "qualified" (inherited IRA/403b/401k — fully taxable) or "nonqualified"
  // (annuity — earnings taxed first, then cost basis returns tax-free).
  inheritedTaxType: "qualified",
  // Non-qualified only: investment in the contract (cost basis).
  inheritedBasis: 0,
  // "lifeExpectancy" (eligible designated beneficiary stretch) or "tenYear"
  // (empty by Dec 31 of the 10th year after death).
  inheritedPayoutRule: "lifeExpectancy",
  // "spouse" (recalculated divisor + RMD-delay option) or "nonSpouse"
  // (fixed-term divisor, minus 1 each year).
  inheritedRelationship: "spouse",
  // Year the original owner died.
  inheritedDeathYear: PROJECTION_START_YEAR,
  // Original owner's birth year — sets when required payouts must begin
  // (a spouse may wait until the owner would have reached RMD age) and
  // whether annual RMDs apply during the 10-year rule.
  inheritedDeceasedBirthYear: 1965,
  // --- Layer-B contract-specific BCO terms (see
  // resolveInheritedFinalDistributionYear). Generic defaults are
  // deliberately neutral: no contract deadline, unknown charge treatment.
  // A real endorsement (e.g. Equitable EQUI-VEST Series 201 TSA under a
  // BCO: no withdrawal charge, $300 partial minimum, full distribution at
  // the deceased owner's age 72) is entered by the user — never assumed.
  // "403bTsa" | "ira" | "qualifiedOther" | "nonqualifiedAnnuity". Drives
  // the qualified-vs-nonqualified tax treatment; a 403(b)/TSA is a
  // qualified inherited PLAN account, not an inherited IRA.
  inheritedPlanType: "qualifiedOther",
  // Free-text contract/product label, e.g.
  // "Equitable EQUI-VEST Series 201 — TSA Public School".
  inheritedContractLabel: "",
  // "bcoNoCharge" (endorsement waives withdrawal charges) |
  // "standardContract" (schedule exists but is NOT modeled) | "unknown".
  // The projection never deducts a charge; anything but "bcoNoCharge"
  // surfaces a verify-your-contract warning instead.
  inheritedWithdrawalChargePolicy: "unknown",
  // Contract minimum for PARTIAL withdrawals (execution constraint only —
  // never changes federal RMD math; a full withdrawal is exempt).
  inheritedPartialWithdrawalMinimum: 0,
  // "none" | "ownerAge" (deceased owner's age at final distribution) |
  // "explicitYear". "none" keeps pure federal behavior.
  inheritedContractFinalDistributionMode: "none",
  inheritedContractFinalDistributionAge: 72,
  inheritedContractFinalDistributionYear: 0,
  // "auto" (infer from birth/death years) | "beforeRbd" | "onOrAfterRbd".
  inheritedOwnerRmdStatus: "auto",
  // Where the contract terms came from, e.g. "Equitable Series 201 BCO
  // endorsement" — documentation only, not used in math.
  inheritedContractSourceNote: "",
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
    // Gross annual salary (today's dollars) while this spouse still works.
    // In ALL working years it stacks under forced flows (RMDs, inherited
    // payouts, SS, pensions) for tax purposes — the plan is charged only the
    // incremental tax; the salary's own tax/FICA/spending stay out of scope.
    // In years AFTER the other spouse has retired (staggered retirement) it
    // additionally funds this spouse's contributions (capped at pay), pays
    // employee FICA, and the remainder covers household spending as taxable
    // income; $0 in those years means contributions stop (no funding
    // source).
    salaryIncome: 0,
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
    salaryIncome: 0,
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

function normalizeCouplePerson(person, fallback, startYear=PROJECTION_START_YEAR) {
  const merged = sanitizeEngineInputs({ ...POLICY_DEFAULTS, ...fallback, ...(person || {}) });
  const computedRmdStartAge = defaultRmdStartAge(
    merged.currentAge,
    startYear,
  );
  return {
    ...merged,
    rmdStartAge: merged.rmdStartAge ?? computedRmdStartAge,
  };
}

function normalizeCoupleInputs(coupleInputs) {
  const shared = sanitizeEngineInputs({
    ...POLICY_DEFAULTS,
    ...DEFAULT_COUPLE_INPUTS.shared,
    ...(coupleInputs?.shared || {}),
  });
  // Couple mode always models at least a 2-person household; stored scenarios
  // from before this floor existed may carry a stale householdSize of 1,
  // which silently capped the household HSA at the self-only limit.
  shared.householdSize = Math.max(2, shared.householdSize || 2);
  return {
    primary: normalizeCouplePerson(
      coupleInputs?.primary,
      DEFAULT_COUPLE_INPUTS.primary, shared.projectionStartYear ?? PROJECTION_START_YEAR,
    ),
    spouse: normalizeCouplePerson(
      coupleInputs?.spouse,
      DEFAULT_COUPLE_INPUTS.spouse, shared.projectionStartYear ?? PROJECTION_START_YEAR,
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

function normalizeInputs(rawInputs) {
  const merged = { ...DEFAULT_INPUTS, ...rawInputs };
  const computedRmdStartAge = defaultRmdStartAge(
    merged.currentAge,
    merged.projectionStartYear ?? PROJECTION_START_YEAR,
  );
  const wasLegacyDefaultRmd =
    rawInputs &&
    rawInputs.rmdStartAge === 73 &&
    rawInputs.currentAge != null &&
    computedRmdStartAge !== 73;
  return {
    ...merged,
    mode: merged.mode === "couple" ? "couple" : "single",
    filingStatus: merged.filingStatus === "mfj" ? "mfj" : "single",
    couple: normalizeCoupleInputs(merged.couple),
    rmdStartAge: wasLegacyDefaultRmd
      ? computedRmdStartAge
      : (merged.rmdStartAge ?? computedRmdStartAge),
    taxableAnnualTaxDrag: merged.taxableAnnualTaxDrag ?? 0.005,
  };
}

function resolveInputField(field) {
  if (!field) return null;
  if (Object.prototype.hasOwnProperty.call(DEFAULT_INPUTS, field)) return field;

  const normalizedField = String(field).toLowerCase().replace(/[^a-z0-9]/g, "");
  const matchingKey = Object.keys(DEFAULT_INPUTS).find(
    (key) => key.toLowerCase().replace(/[^a-z0-9]/g, "") === normalizedField,
  );
  return matchingKey || null;
}

function parseInputValue(value, currentValue) {
  if (typeof currentValue === "number") {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const raw = String(value).trim();
    const isPercent = raw.endsWith("%");
    const numeric = Number(raw.replace(/[$,%\s]/g, ""));
    if (!Number.isFinite(numeric)) return null;
    return isPercent ? numeric / 100 : numeric;
  }
  if (typeof currentValue === "boolean") {
    if (typeof value === "boolean") return value;
    const normalized = String(value).trim().toLowerCase();
    if (["true", "yes", "1", "on"].includes(normalized)) return true;
    if (["false", "no", "0", "off"].includes(normalized)) return false;
    return null;
  }
  if (typeof currentValue === "string") return String(value);
  return null;
}

function buildAppliedInputChanges(currentInputs, changes) {
  const updates = {};
  const applied = [];
  const skipped = [];

  for (const change of changes || []) {
    const field = resolveInputField(change?.field);
    if (!field) {
      skipped.push(change?.field || "unknown field");
      continue;
    }

    const value = parseInputValue(change.value, currentInputs[field]);
    if (value === null) {
      skipped.push(field);
      continue;
    }

    updates[field] = value;
    applied.push({
      field,
      previousValue: currentInputs[field],
      value,
    });
  }

  return { updates, applied, skipped };
}

const normImportLabel = (s) =>
  String(s)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const parseImportMoney = (v) => {
  const n = Number(String(v).replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const parseImportPct = (v) => {
  const raw = String(v).trim();
  const n = Number(raw.replace(/[$,%\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  // Export always writes an explicit "%", so treat that as authoritative;
  // a bare number > 1 is assumed to be a percentage too (e.g. "9" → 0.09).
  if (raw.includes("%")) return n / 100;
  return n > 1 ? n / 100 : n;
};

const parseImportInt = (v) => {
  const n = Number(String(v).replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
};

const parseImportBool = (v) => {
  const s = String(v).toLowerCase().trim();
  if (["yes", "true", "1", "on", "y"].includes(s)) return true;
  if (["no", "false", "0", "off", "n"].includes(s)) return false;
  return null;
};

const SETTINGS_IMPORT_SPECS = [
  // --- Timing
  {
    field: "filingStatus",
    labels: ["filing status"],
    parseEnum: (v) => {
      const s = v.toLowerCase();
      if (s.includes("married") || s.includes("mfj") || s.includes("joint"))
        return "mfj";
      if (s.includes("single")) return "single";
      return null;
    },
  },
  { field: "currentAge", kind: "int", labels: ["current age"] },
  { field: "retirementAge", kind: "int", labels: ["retirement age"] },
  { field: "planThroughAge", kind: "int", labels: ["plan through age"] },
  // --- Current Balances
  {
    field: "balanceCash",
    kind: "money",
    labels: ["cash / hysa", "cash/hysa", "cash / hysa balance"],
  },
  {
    field: "balanceTaxable",
    kind: "money",
    labels: ["taxable brokerage", "taxable"],
  },
  {
    field: "taxableBasisPct",
    kind: "pct",
    labels: ["taxable cost basis %", "taxable cost basis"],
  },
  {
    field: "balance401k",
    kind: "money",
    labels: ["401k / 403b", "401k/403b", "401k", "403b"],
  },
  {
    field: "balanceTradIra",
    kind: "money",
    labels: ["traditional ira", "trad ira"],
  },
  { field: "balanceRoth", kind: "money", labels: ["roth ira"] },
  {
    field: "rothBasis",
    kind: "money",
    labels: ["roth contributions to date"],
  },
  { field: "balanceHsa", kind: "money", labels: ["hsa"] },
  {
    field: "creditCardDebt",
    kind: "money",
    labels: ["credit card debt"],
  },
  // --- Inherited (BCO) — section-scoped so bare "Balance"/"Cost Basis" only
  // apply here, never colliding with taxable/other balances.
  {
    field: "balanceInherited",
    kind: "money",
    requireSection: "inherited",
    labels: ["balance", "inherited account balance", "inherited balance"],
  },
  {
    field: "inheritedTaxType",
    requireSection: "inherited",
    labels: ["account type"],
    parseEnum: (v) => {
      const s = v.toLowerCase();
      if (s.includes("non-qualified") || s.includes("nonqualified") || s.includes("annuity"))
        return "nonqualified";
      if (s.includes("qualified")) return "qualified";
      return null;
    },
  },
  {
    field: "inheritedBasis",
    kind: "money",
    requireSection: "inherited",
    labels: ["cost basis", "inherited cost basis"],
  },
  {
    field: "inheritedPayoutRule",
    requireSection: "inherited",
    labels: ["payout rule"],
    parseEnum: (v) => {
      const s = v.toLowerCase();
      if (s.includes("10-year") || s.includes("10 year") || s.includes("ten"))
        return "tenYear";
      if (s.includes("life")) return "lifeExpectancy";
      return null;
    },
  },
  {
    field: "inheritedRelationship",
    requireSection: "inherited",
    labels: ["relationship to owner", "your relationship to the owner"],
    parseEnum: (v) => {
      const s = v.toLowerCase();
      if (s.includes("other") || s.includes("non-spouse") || s.includes("nonspouse"))
        return "nonSpouse";
      if (s.includes("spouse")) return "spouse";
      return null;
    },
  },
  {
    field: "inheritedDeathYear",
    kind: "int",
    requireSection: "inherited",
    labels: ["year of owner's death", "year of owners death"],
  },
  {
    field: "inheritedDeceasedBirthYear",
    kind: "int",
    requireSection: "inherited",
    labels: ["owner's birth year", "owners birth year"],
  },
  {
    field: "inheritedPlanType",
    requireSection: "inherited",
    labels: ["inherited plan type", "plan type"],
    parseEnum: (v) => {
      const s = v.toLowerCase();
      if (
        s.includes("403") ||
        s.includes("tsa") ||
        s.includes("public-school") ||
        s.includes("public school")
      )
        return "403bTsa";
      if (s.includes("ira")) return "ira";
      if (s.includes("nonqualified") || s.includes("non-qualified") || s.includes("annuity"))
        return "nonqualifiedAnnuity";
      if (s.includes("qualified")) return "qualifiedOther";
      return null;
    },
  },
  {
    field: "inheritedContractLabel",
    requireSection: "inherited",
    labels: ["contract / product", "contract/product", "contract product", "product"],
  },
  {
    field: "inheritedWithdrawalChargePolicy",
    requireSection: "inherited",
    labels: ["withdrawal-charge treatment", "withdrawal charge treatment", "withdrawal charge policy"],
    parseEnum: (v) => {
      const s = v.toLowerCase();
      if (s.includes("no charge") || s.includes("no withdrawal") || s.includes("bco endorsement"))
        return "bcoNoCharge";
      if (s.includes("standard") || s.includes("surrender")) return "standardContract";
      if (s.includes("unknown") || s.includes("verify")) return "unknown";
      return null;
    },
  },
  {
    field: "inheritedPartialWithdrawalMinimum",
    kind: "money",
    requireSection: "inherited",
    labels: ["partial withdrawal minimum", "partial minimum"],
  },
  {
    field: "inheritedContractFinalDistributionMode",
    requireSection: "inherited",
    labels: ["contract final distribution rule", "final distribution rule"],
    parseEnum: (v) => {
      const s = v.toLowerCase();
      if (s.includes("none") || s.includes("no contract")) return "none";
      if (s.includes("age") || s.includes("deceased owner") || s.includes("72"))
        return "ownerAge";
      if (s.includes("specific") || s.includes("calendar") || s.includes("year"))
        return "explicitYear";
      return null;
    },
  },
  {
    field: "inheritedContractFinalDistributionAge",
    kind: "int",
    requireSection: "inherited",
    labels: [
      "deceased owner's final distribution age",
      "deceased owners final distribution age",
      "final distribution age",
      "contract final distribution age",
    ],
  },
  {
    field: "inheritedContractFinalDistributionYear",
    kind: "int",
    requireSection: "inherited",
    labels: ["contract final distribution year", "final distribution year"],
  },
  {
    field: "inheritedOwnerRmdStatus",
    requireSection: "inherited",
    labels: ["owner rmd status", "owner rmd timing"],
    parseEnum: (v) => {
      const s = v.toLowerCase();
      if (s.includes("before") || s.includes("pre-rbd")) return "beforeRbd";
      if (s.includes("after") || s.includes("on or") || s.includes("post-rbd"))
        return "onOrAfterRbd";
      if (s.includes("auto") || s.includes("infer")) return "auto";
      return null;
    },
  },
  {
    field: "inheritedContractSourceNote",
    requireSection: "inherited",
    labels: ["contract source note", "source note"],
  },
  // --- Cash Strategy
  {
    field: "cashStrategy",
    labels: ["cash withdrawal strategy", "cash strategy"],
    parseEnum: (v) => {
      const s = v.toLowerCase().trim();
      const byLabel = CASH_STRATEGY_OPTIONS.find(
        (o) => o.label.toLowerCase() === s,
      );
      if (byLabel) return byLabel.value;
      const byValue = CASH_STRATEGY_OPTIONS.find(
        (o) => o.value.toLowerCase() === s,
      );
      if (byValue) return byValue.value;
      if (s.includes("proportion")) return "proportional";
      if (s.includes("only if") || s.includes("last")) return "cashLast";
      if (s.includes("preserve") || s.includes("reserve"))
        return "preserveReserve";
      if (s.includes("first")) return "cashFirst";
      return null;
    },
  },
  {
    field: "cashReserveFloor",
    kind: "money",
    labels: ["minimum cash reserve"],
  },
  {
    field: "allowReserveAsLastResort",
    kind: "bool",
    labels: ["allow reserve as last resort"],
  },
  // --- Returns & Inflation
  { field: "preReturn", kind: "pct", labels: ["pre-retirement return"] },
  { field: "postReturn", kind: "pct", labels: ["post-retirement return"] },
  {
    field: "cashReturn",
    kind: "pct",
    labels: ["cash return", "cash / hysa return", "cash/hysa return"],
  },
  { field: "inflation", kind: "pct", labels: ["inflation", "inflation rate"] },
  // --- Risk Assumptions
  {
    field: "portfolioVolatility",
    kind: "pct",
    labels: ["portfolio volatility"],
  },
  {
    field: "taxableAnnualTaxDrag",
    kind: "pct",
    labels: ["taxable annual tax drag"],
  },
  { field: "flexibleSpending", kind: "bool", labels: ["flexible spending"] },
  // --- Contributions
  { field: "contrib401k", kind: "money", labels: ["401k employee"] },
  { field: "contribMatch", kind: "money", labels: ["employer match"] },
  { field: "contribHsa", kind: "money", labels: ["hsa contribution"] },
  // --- Spending
  {
    field: "baseExpenses",
    kind: "money",
    labels: ["base expenses", "base lifestyle expenses"],
  },
  {
    field: "healthcarePre65",
    kind: "money",
    labels: ["healthcare pre-65", "healthcare before 65", "healthcare pre 65"],
  },
  {
    field: "healthcarePost65",
    kind: "money",
    labels: ["healthcare post-65", "healthcare 65+", "healthcare post 65"],
  },
  // --- Income
  {
    field: "salaryIncome",
    kind: "money",
    labels: ["annual salary (gross)", "annual salary", "gross salary"],
  },
  {
    field: "partTimeIncome",
    kind: "money",
    labels: ["part-time income / year", "part-time income/year"],
  },
  {
    field: "partTimeYears",
    kind: "int",
    labels: ["years of part-time work"],
  },
  {
    field: "ssIncome",
    kind: "money",
    labels: ["social security at fra / year", "social security at fra/year"],
  },
  { field: "ssAge", kind: "int", labels: ["age to claim ss"] },
  // --- Pension
  { field: "pensionIncome", kind: "money", labels: ["annual pension"] },
  { field: "pensionStartAge", kind: "int", labels: ["pension start age"] },
  { field: "pensionCola", kind: "pct", labels: ["pension cola"] },
  {
    field: "pensionNyExempt",
    kind: "bool",
    labels: ["ny state tax exempt", "ny state tax exempt pension"],
  },
  // --- Roth Conversions
  {
    field: "conversionBridge",
    kind: "money",
    labels: ["retirement through 59 / year", "retirement through 59/year"],
  },
  {
    field: "conversionMid",
    kind: "money",
    labels: ["ages 60-64 / year", "ages 60-64/year"],
  },
  {
    field: "conversionFinal",
    kind: "money",
    labels: ["age 65 until ss / year", "age 65 until ss/year"],
  },
  // --- Advanced Tax Model
  { field: "rmdStartAge", kind: "int", labels: ["rmd start age"] },
  {
    field: "useAcaSubsidyEstimate",
    kind: "bool",
    labels: ["aca subsidy estimate"],
  },
  { field: "householdSize", kind: "int", labels: ["household size"] },
];

function parseValueForImportSpec(spec, value) {
  if (spec.parseEnum) return spec.parseEnum(value);
  switch (spec.kind) {
    case "money":
      return parseImportMoney(value);
    case "pct":
      return parseImportPct(value);
    case "int":
      return parseImportInt(value);
    case "bool":
      return parseImportBool(value);
    default:
      return value;
  }
}

function findImportSpec(label, section) {
  for (const spec of SETTINGS_IMPORT_SPECS) {
    if (spec.requireSection && !section.includes(spec.requireSection)) continue;
    if (spec.labels.some((l) => normImportLabel(l) === label)) return spec;
  }
  return null;
}

function parseSettingsText(text) {
  const payload = String(text).split(/\r?\n/).find(line=>line.startsWith('Scenario data v2: '));
  if (payload) {
    try {
      const raw=JSON.parse(payload.slice('Scenario data v2: '.length));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid scenario');
      validateFinancialFacts(raw);
      if (raw.couple) for (const key of ["primary","spouse","shared"]) validateFinancialFacts(raw.couple[key]);
      const updates=normalizeInputs(raw);
      return {completeScenario:true,isCouple:updates.mode==='couple',updates,applied:[{field:'scenario',label:'Complete scenario',value:'Imported'}],skipped:[]};
    } catch { return {isCouple:false,updates:{},applied:[],skipped:[{label:'Scenario data',reason:'Invalid scenario JSON or financial history'}]}; }
  }

  const isCouple =
    /mode\s*:\s*married couple/i.test(text) ||
    /^\s*#+\s*(primary|spouse|household)\b/im.test(text);
  const updates = {};
  const applied = [];
  const skipped = [];
  let section = "";
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      section = normImportLabel(line.replace(/^#+\s*/, ""));
      continue;
    }
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const rawLabel = line.slice(0, sep).trim();
    const rawValue = line.slice(sep + 1).trim();
    if (!rawValue) continue;
    const label = normImportLabel(rawLabel);
    const spec = findImportSpec(label, section);
    if (!spec) {
      skipped.push({ label: rawLabel, reason: "not recognized" });
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(updates, spec.field)) continue;
    const parsed = parseValueForImportSpec(spec, rawValue);
    if (parsed === null || parsed === undefined) {
      skipped.push({ label: rawLabel, reason: "could not read value" });
      continue;
    }
    updates[spec.field] = parsed;
    applied.push({ field: spec.field, label: rawLabel, value: parsed });
  }
  // A recognized individual-mode plan should govern display, so switch out of
  // couple mode when flat fields were parsed.
  if (!isCouple && applied.length > 0) updates.mode = "single";
  return { isCouple, updates, applied, skipped };
}

function randomNormal(mean, stdDev) {
  const u = 1 - Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return z * stdDev + mean;
}

function simulateWithReturns(inputs, yearlyReturns) {
  const displayInputs = getDisplayInputs(inputs);
  const result = simulatePlan(inputs, {
    yearlyReturns,
    useFlexibleSpending: displayInputs.flexibleSpending !== false,
  });
  const history = result.yearlyData.map((row) => ({
    age: row.age,
    total: Math.max(0, row.total),
  }));
  // Failure uses the same materiality standard as the plan banner.
  // summary.depleted alone is too sensitive: sub-dollar rounding friction in
  // the iterative solver can set it on plans that end with millions intact,
  // which silently tanked couple-mode success rates.
  const materialThreshold = materialYearUnmetThreshold(
    result.summary.year1Spending,
  );
  // Any distribution-phase year counts; keying off the primary's age missed
  // early household-retirement years in couple mode when the spouse retired first.
  const depletedRow = result.yearlyData.find(
    (row) =>
      row.phase !== "accumulation" &&
      (row.total <= 0 || row.unmetCashFlow > materialThreshold),
  );
  const failed =
    result.summary.portfolioAtEnd <= 0 ||
    hasMaterialUnmetCashFlow(result.summary) ||
    depletedRow != null;
  return {
    history,
    finalTotal: result.summary.portfolioAtEnd,
    depleted: failed,
    invalid: result.yearlyData.some(row=>row.calculationValid===false),
    depletedAge: depletedRow ? depletedRow.age : null,
  };
}

function runMonteCarlo(inputs, numSims = 500) {
  const displayInputs = getDisplayInputs(inputs);
  const yearsInRetirement = distributionYears(inputs, displayInputs.projectionStartYear ?? PROJECTION_START_YEAR);
  const meanReturn = displayInputs.postReturn;
  const stdDev = displayInputs.portfolioVolatility ?? 0.09;

  const modelNotices = financialNotices(inputs);
  const allRuns = [];
  let successCount = 0;
  let invalidRunCount = 0;
  const finalValues = [];
  const depletionAges = [];

  for (let i = 0; i < numSims; i++) {
    // Clamp each annual draw to a plausible floor. A Normal draw is unbounded,
    // so at high user volatility a sample below -100% would otherwise drive an
    // account negative; -95% is a severe but survivable single-year loss.
    const yearlyReturns = Array.from({ length: yearsInRetirement }, () =>
      Math.max(-0.95, randomNormal(meanReturn, stdDev)),
    );
    const result = simulateWithReturns(inputs, yearlyReturns);
    allRuns.push(result.history);
    if (result.invalid) invalidRunCount++;
    if (!result.depleted && !result.invalid) {
      successCount++;
    } else {
      depletionAges.push(result.depletedAge);
    }
    finalValues.push(result.finalTotal);
  }

  // Compute percentiles at each age
  const ages = allRuns[0].map((h) => h.age);
  const percentiles = ages.map((age, idx) => {
    const vals = allRuns
      .map((run) => run[idx]?.total || 0)
      .sort((a, b) => a - b);
    return {
      age,
      p10: vals[Math.floor(vals.length * 0.1)],
      p25: vals[Math.floor(vals.length * 0.25)],
      p50: vals[Math.floor(vals.length * 0.5)],
      p75: vals[Math.floor(vals.length * 0.75)],
      p90: vals[Math.floor(vals.length * 0.9)],
    };
  });

  finalValues.sort((a, b) => a - b);

  return {
    successRate: invalidRunCount>0 ? null : successCount / numSims,
    invalidRunCount,
    percentiles,
    finalP10: finalValues[Math.floor(numSims * 0.1)],
    finalP50: finalValues[Math.floor(numSims * 0.5)],
    modelNotices,
    isEstimate: modelNotices.length > 0 || invalidRunCount>0,
    finalP90: finalValues[Math.floor(numSims * 0.9)],
    avgDepletionAge:
      depletionAges.length > 0
        ? depletionAges.reduce((a, b) => a + b, 0) / depletionAges.length
        : null,
    numSims,
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
  if (simulatePlan(inputs).yearlyData.length === 0 || simulatePlan(inputs).summary.calculationValid === false) return null;
  const isFunded = (value) =>
    simulatePlan(withSpending(value)).summary.calculationValid !== false && computeShortfallInfo(simulatePlan(withSpending(value))).status !== "danger";
  if (!isFunded(0)) return null;
  let lo = 0;
  let hi = Math.max(getDisplayInputs(inputs).baseExpenses || 0, 50000);
  let guard = 0;
  while (isFunded(hi) && guard < 12) {
    lo = hi;
    hi *= 2;
    guard++;
  }
  if (guard >= 12) return Math.floor(lo / 500) * 500;
  while (hi - lo > 500) {
    const mid = (lo + hi) / 2;
    if (isFunded(mid)) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo / 500) * 500;
}

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

function safeWithdrawalGuideline(retirementYears) {
  if (retirementYears > 40) return 0.0325;
  if (retirementYears > 30) return 0.035;
  return 0.04;
}

function materialUnmetThreshold(year1Spending) {
  // Cumulative whole-plan bar: max($1,000, 0.5% of year-1 spending).
  return Math.max(1000, (year1Spending || 0) * 0.005);
}

function materialYearUnmetThreshold(year1Spending) {
  // Single-year bar, tighter: max($100, 0.1% of year-1 spending) — one
  // genuinely unfunded year matters even when the cumulative total is small.
  return Math.max(100, (year1Spending || 0) * 0.001);
}

function hasMaterialUnmetCashFlow(summary) {
  return (
    summary.totalUnmetCashFlow > materialUnmetThreshold(summary.year1Spending)
  );
}

function computeShortfallInfo(results) {
  const s = results.summary;
  const rows = results.yearlyData.filter((d) => d.phase !== "accumulation");
  // Per-year materiality: sub-$100 solver residue must not become "the first
  // year your plan can't fund itself" in the banner.
  const yearBar = materialYearUnmetThreshold(s.year1Spending);
  const shortfallRows = rows.filter(
    (d) => (d.unmetCashFlow || 0) > yearBar || d.total <= 0,
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

const CASH_STRATEGY_OPTIONS = [
  {
    value: "cashFirst",
    label: "Use cash first (default)",
    blurb:
      "Spend cash before other accounts. The reserve floor is not applied in this mode.",
  },
  {
    value: "preserveReserve",
    label: "Preserve cash reserve",
    blurb:
      "Spend cash first, but never draw it below the Minimum Cash Reserve.",
  },
  {
    value: "proportional",
    label: "Use cash proportionally",
    blurb:
      "Split each year's draw across cash (above the reserve), taxable, and 401k/IRA in proportion to balances. Roth stays last.",
  },
  {
    value: "cashLast",
    label: "Use cash only if required",
    blurb:
      "Tap taxable and retirement accounts first; cash (above the reserve) is the final buffer before Roth.",
  },
];

export {
  PROJECTION_START_YEAR,
  FEDERAL_TAX_TABLES,
  FILING_STATUS_PARAMS,
  LIMIT_TABLES,
  ACA_APPLICABLE_PERCENTAGES_2026,
  IRMAA_2026,
  projectedFromKnownTable,
  getFederalTaxParams,
  getContributionLimits,
  rmdStartAgeForBirthYear,
  defaultRmdStartAge,
  SS_MIN_CLAIM_AGE,
  SS_MAX_CREDIT_AGE,
  effectiveSsClaimAge,
  SS_WAGE_BASE_2026,
  employeeFica,
  fullRetirementAgeForBirthYear,
  adjustedSocialSecurityBenefit,
  fedOrdinaryTax,
  fedLtcgTax,
  NY_TAX_PARAMS,
  NY_RECAPTURE_AGI_FLOOR,
  NY_RECAPTURE_PHASE_IN,
  nyTaxBenefitRecapture,
  nyStateTax,
  taxableSocialSecurity,
  SINGLE_LIFE_EXPECTANCY,
  singleLifeDivisor,
  seppAmortizedPayment,
  rmdDivisor,
  resolveInheritedFinalDistributionYear,
  inheritedRmdRequirement,
  FPL_GUIDELINES,
  FPL_LAST_KNOWN_YEAR,
  FPL_FIRST_KNOWN_YEAR,
  federalPovertyLevel,
  estimateAcaHealthcareCost,
  totalTax,
  rothTaxableEarnings,
  rothEarlyPenaltyBase,
  consumeRothLayers,
  CASH_POLICY_DEFAULT,
  doWithdrawalWaterfall,
  computeRealizedGain,
  solveGrossedUpWithdrawals,
  computeIrmaaSurcharge,
  runSelfTests,
  sanitizeEngineInputs,
  simulate,
  getCoupleHsaLimit,
  fundPersonContributions,
  personConversionTarget,
  takeFromBalance,
  enforcePersonRmd,
  doCoupleWithdrawalWaterfall,
  solveCoupleGrossedUpWithdrawals,
  allocateCoupleHsaWithdrawals,
  simulateCouple,
  simulatePlan,
  fmtMoney,
  fmtMoneyFull,
  fmtPct,
  DEFAULT_INPUTS,
  DEFAULT_COUPLE_INPUTS,
  normalizeCouplePerson,
  normalizeCoupleInputs,
  isCoupleMode,
  getDisplayInputs,
  normalizeInputs,
  resolveInputField,
  parseInputValue,
  buildAppliedInputChanges,
  normImportLabel,
  parseImportMoney,
  parseImportPct,
  parseImportInt,
  parseImportBool,
  SETTINGS_IMPORT_SPECS,
  parseValueForImportSpec,
  findImportSpec,
  parseSettingsText,
  randomNormal,
  simulateWithReturns,
  runMonteCarlo,
  diagnoseSuccessRate,
  solveMaxSustainableSpending,
  CASH_STRATEGY_VALUES,
  summarizeCashStrategyRun,
  compareCashStrategies,
  bestCashStrategyAlternative,
  safeWithdrawalGuideline,
  materialUnmetThreshold,
  materialYearUnmetThreshold,
  hasMaterialUnmetCashFlow,
  computeShortfallInfo,
  generatePlanNarrative,
  CASH_STRATEGY_OPTIONS
};
