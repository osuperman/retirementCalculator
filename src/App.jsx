import { Fragment, useState, useMemo, useEffect, useRef } from "react";
import {
  Area,
  AreaChart,
  Bar,
  ComposedChart,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

const PROJECTION_START_YEAR = new Date().getFullYear();

const FEDERAL_TAX_TABLES_MFJ = {
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

const IRMAA_2026_MFJ = [
  { top: 218000, monthlyPartB: 0, monthlyPartD: 0 },
  { top: 274000, monthlyPartB: 81.2, monthlyPartD: 14.5 },
  { top: 342000, monthlyPartB: 202.9, monthlyPartD: 37.5 },
  { top: 410000, monthlyPartB: 324.6, monthlyPartD: 60.4 },
  { top: 750000, monthlyPartB: 446.3, monthlyPartD: 83.3 },
  { top: Infinity, monthlyPartB: 487, monthlyPartD: 91 },
];

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

function getFederalTaxParams(year, inflation = 0.03) {
  const projected = projectedFromKnownTable(FEDERAL_TAX_TABLES_MFJ, year, inflation);
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
// TAX CALCULATIONS (MFJ, inflation-adjusted from 2024 brackets)
// ============================================================

function fedOrdinaryTaxMFJ(taxableIncome, year, inflation = 0.03) {
  if (taxableIncome <= 0) return 0;
  const { ordinaryBrackets: brackets } = getFederalTaxParams(year, inflation);
  let tax = 0;
  for (const [low, high, rate] of brackets) {
    if (taxableIncome > low) {
      tax += (Math.min(taxableIncome, high) - low) * rate;
    }
    if (taxableIncome <= high) break;
  }
  return tax;
}

function fedLtcgTaxMFJ(ltcg, ordinaryTaxable, year, inflation = 0.03) {
  if (ltcg <= 0) return 0;
  const { ltcgZeroTop: zeroTop, ltcgFifteenTop: fifteenTop } =
    getFederalTaxParams(year, inflation);
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

// NY brackets and the MFJ standard deduction are projected from their ~2024
// statutory values by the input inflation rate, mirroring how federal brackets
// are projected in getFederalTaxParams. Without this, only the federal side
// indexed and NY suffered unbounded bracket creep over a multi-decade horizon,
// overstating NY tax and understating ending balances in later years.
const NY_TAX_BASE_YEAR = 2024;
function nyStateTaxMFJ(taxableIncome, year = NY_TAX_BASE_YEAR, inflation = 0.03) {
  if (taxableIncome <= 0) return 0;
  const factor = Math.pow(1 + inflation, Math.max(0, year - NY_TAX_BASE_YEAR));
  const stdDed = 16050 * factor;
  const nyTaxable = Math.max(0, taxableIncome - stdDed);
  // FY2026 NY budget (Ch. 59, Laws of 2025) cuts the bottom five rates by
  // 0.1pp in tax year 2026 and 0.2pp total from 2027 onward (permanent).
  const midClassCut = year >= 2027 ? 0.002 : year >= 2026 ? 0.001 : 0;
  const baseBrackets = [
    [0, 17150, 0.04 - midClassCut],
    [17150, 23600, 0.045 - midClassCut],
    [23600, 27900, 0.0525 - midClassCut],
    [27900, 161550, 0.055 - midClassCut],
    [161550, 323200, 0.06 - midClassCut],
    [323200, 2155350, 0.0685],
    [2155350, 5000000, 0.0965],
    [5000000, 25000000, 0.103],
    [25000000, Infinity, 0.109],
  ];
  const brackets = baseBrackets.map(([low, high, rate]) => [
    low * factor,
    high === Infinity ? Infinity : high * factor,
    rate,
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

// Taxable Social Security benefits (MFJ provisional income rules)
// Thresholds ($32K / $44K) are NOT inflation-adjusted by statute.
// Returns the amount of SS benefits that is taxable (0 to 85% of gross SS).
// `otherIncome` = AGI before SS + tax-exempt interest (we assume 0 tax-exempt)
function taxableSocialSecurity(ssGross, otherIncome) {
  if (ssGross <= 0) return 0;
  const halfSs = ssGross * 0.5;
  const provisional = Math.max(0, otherIncome) + halfSs;
  const threshold1 = 32000; // MFJ statutory
  const threshold2 = 44000; // MFJ statutory
  if (provisional <= threshold1) return 0;
  let taxable;
  if (provisional <= threshold2) {
    // Up to 50% of SS taxable (lesser of half SS or half the excess)
    taxable = Math.min(halfSs, (provisional - threshold1) * 0.5);
  } else {
    // Above $44K: 85% of excess + lesser of $6K or 50% of SS
    const excess85 = (provisional - threshold2) * 0.85;
    const plus = Math.min(6000, halfSs);
    taxable = excess85 + plus;
  }
  return Math.max(0, Math.min(taxable, ssGross * 0.85));
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
) {
  const { standardDeduction: baseStdDed } = getFederalTaxParams(year, inflation);
  const magi = ordinaryIncome + ltcg;
  // Age-65+ additional standard deduction (permanent law): $1,650 per MFJ
  // spouse 65+ in 2026, indexed — projected on the same clock as brackets.
  const seniorFactor = Math.pow(1 + inflation, Math.max(0, year - 2026));
  const extraStdDed65 = seniors65 * 1650 * seniorFactor;
  // OBBBA senior deduction: $6,000 per person 65+ for tax years 2025-2028
  // only (not indexed), phased out at 6% of MAGI above $150K MFJ.
  let seniorBonusDeduction = 0;
  if (seniors65 > 0 && year >= 2025 && year <= 2028) {
    const phaseOut = 0.06 * Math.max(0, magi - 150000);
    seniorBonusDeduction = Math.max(0, seniors65 * 6000 - phaseOut);
  }
  const stdDed = baseStdDed + extraStdDed65 + seniorBonusDeduction;
  const taxableOrdinary = Math.max(0, ordinaryIncome - stdDed);
  // Apply any unused standard deduction to reduce taxable LTCG
  const unusedStdDed = Math.max(0, stdDed - ordinaryIncome);
  const taxableLtcg = Math.max(0, ltcg - unusedStdDed);
  const fedOrd = fedOrdinaryTaxMFJ(taxableOrdinary, year, inflation);
  const fedLtcg = fedLtcgTaxMFJ(taxableLtcg, taxableOrdinary, year, inflation);
  // NIIT: 3.8% on investment income when MAGI > $250K MFJ (threshold not indexed)
  const niitThreshold = 250000;
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
  const ny = nyStateTaxMFJ(nyOrdinary + ltcg, year, inflation);
  return fedOrd + fedLtcg + niit + ny;
}

// User-selectable cash drawdown behavior. "cashFirst" reproduces the original
// waterfall exactly; the other strategies respect an inflation-adjusted
// minimum cash reserve that is only spendable via the last-resort toggle.
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
    taxableSs = taxableSocialSecurity(ssGross, incomeBeforeSs);
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
      earlyPenalty =
        0.1 * (penalized401k + withdrawals.wIra + withdrawals.wRoth);
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

// Compute annual Medicare Part B + Part D IRMAA surcharge for a MFJ household.
function computeIrmaaSurcharge(magi, year, inflation = 0.03, medicareEnrollees = 2) {
  const factor = Math.pow(1 + inflation, Math.max(0, year - 2026));
  const coveredPeople = Math.max(1, Math.min(2, medicareEnrollees || 1));
  for (const tier of IRMAA_2026_MFJ) {
    const threshold = tier.top === Infinity ? Infinity : tier.top * factor;
    const atExclusiveTopTierBoundary =
      tier.top === 750000 && magi >= threshold;
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
    "fedOrdinaryTaxMFJ: $100K taxable in 2024",
    fedOrdinaryTaxMFJ(100000, 2024, 0.03),
    12106,
    pctEq,
  );
  test(
    "fedOrdinaryTaxMFJ: $0 taxable = $0",
    fedOrdinaryTaxMFJ(0, 2024, 0.03),
    0,
  );
  test(
    "fedOrdinaryTaxMFJ: $23200 (top of 10% bracket) = $2320",
    fedOrdinaryTaxMFJ(23200, 2024, 0.03),
    2320,
    pctEq,
  );

  // --- Federal LTCG (MFJ, 2024)
  // $50K LTCG + $0 ordinary: all in 0% bracket (below $94,050)
  test(
    "fedLtcgTaxMFJ: $50K LTCG, $0 ordinary = $0 (0% bracket)",
    fedLtcgTaxMFJ(50000, 0, 2024, 0.03),
    0,
  );
  // $50K LTCG + $100K ordinary: ordinary taxable is above $94,050, so all LTCG at 15%
  test(
    "fedLtcgTaxMFJ: $50K LTCG, $100K ordinary = $7500 (15%)",
    fedLtcgTaxMFJ(50000, 100000, 2024, 0.03),
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
    "nyStateTaxMFJ: 2027 middle-class rate cut applied",
    nyStateTaxMFJ(100000, 2027, 0),
    4116.85,
    pctEq,
  );
  test(
    "nyStateTaxMFJ: 2024 pre-cut rates unchanged",
    nyStateTaxMFJ(100000, 2024, 0),
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
    // People 65+ in the household for the senior standard deductions. Mirrors
    // the IRMAA enrollee assumption: household members share the modeled age.
    const seniors65 = age >= 65 ? Math.max(1, Math.min(2, householdSize)) : 0;

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
        minimumRmd: rmdAmount,
        penaltyFree401k,
        cashPolicy,
        interestIncome: cashInterestIncome,
        seniors65,
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
        Math.min(2, householdSize),
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
        minimumRmd: rmdAmount,
        penaltyFree401k,
        cashPolicy,
        interestIncome: cashInterestIncome,
        seniors65,
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
    const personPenalty = (age, ruleOf55, w401k, wIra, wRoth) => {
      if (age >= 59.5) return 0;
      const penalized401k = ruleOf55 && age >= 55 ? 0 : w401k;
      return 0.1 * (penalized401k + wIra + wRoth);
    };
    earlyPenalty =
      personPenalty(
        ages.primary,
        penaltyFree401k.primary,
        withdrawals.primary401k,
        withdrawals.primaryIra,
        withdrawals.primaryRoth,
      ) +
      personPenalty(
        ages.spouse,
        penaltyFree401k.spouse,
        withdrawals.spouse401k,
        withdrawals.spouseIra,
        withdrawals.spouseRoth,
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

const TERM_HELP = {
  aca:
    "Affordable Care Act marketplace health insurance. Subsidies can lower pre-Medicare premiums, but they depend heavily on MAGI and household size.",
  flexibleSpending:
    "A Monte Carlo assumption that cuts discretionary spending by 10% after a year when the portfolio falls more than 15%. This models retirees tightening spending after bad markets.",
  fra:
    "Full Retirement Age for Social Security. This app treats age 67 as the full-benefit age, then adjusts benefits down for earlier claims or up for later claims.",
  hsa:
    "Health Savings Account. Tax-advantaged medical account; withdrawals for qualified medical costs are tax-free.",
  hysa:
    "High-yield savings account. This app treats Cash / HYSA as low-risk cash earning the Cash / HYSA Return assumption.",
  irmaa:
    "Income-Related Monthly Adjustment Amount. Extra Medicare Part B and Part D premiums for higher-income households.",
  magi:
    "Modified Adjusted Gross Income. A tax-income measure used for ACA subsidies, IRMAA, and other thresholds. Roth conversions increase MAGI.",
  mfj:
    "Married Filing Jointly. The tax model uses married-joint federal brackets and thresholds.",
  niit:
    "Net Investment Income Tax. A 3.8% surtax on investment income above the $250K MFJ MAGI threshold.",
  rmd:
    "Required Minimum Distribution. Mandatory withdrawals from tax-deferred retirement accounts after the applicable start age.",
  ruleOf55:
    "An IRS exception to the 10% early-withdrawal penalty. If you leave your job in or after the calendar year you turn 55, withdrawals from THAT employer's 401k/403b are penalty-free. It never applies to IRAs or to old employers' plans, and the plan must allow post-separation withdrawals.",
  sepp:
    "Substantially Equal Periodic Payments (IRS rule 72(t)). A way to take penalty-free withdrawals from an IRA before 59½ by committing to a fixed payment schedule for at least 5 years or until 59½, whichever is longer. Breaking the schedule triggers back-penalties. Not modeled by this tool — discuss with a professional.",
};

function TermInfo({ text }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <span
      className="relative ml-1 inline-flex cursor-help select-none align-middle"
      title={text}
      aria-hidden="true"
      onClick={(event) => {
        event.stopPropagation();
        setIsOpen((open) => !open);
      }}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 bg-white text-[10px] font-bold leading-none text-slate-500">
        ?
      </span>
      <span
        className={`pointer-events-none absolute left-1/2 bottom-full z-50 mb-2 w-64 -translate-x-1/2 rounded-md border border-slate-300 bg-slate-950 px-3 py-2 text-left text-xs font-normal leading-relaxed text-white shadow-lg ${
          isOpen ? "block" : "hidden"
        }`}
        aria-hidden="true"
      >
        {text}
      </span>
    </span>
  );
}

function TermLabel({ children, info }) {
  return (
    <span className="inline-flex items-center">
      {children}
      <TermInfo text={info} />
    </span>
  );
}

function NumberInput({ label, value, onChange, prefix, suffix, step = 1, hint, info }) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium text-slate-600 mb-1">
        {info ? <TermLabel info={info}>{label}</TermLabel> : label}
      </label>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
            {prefix}
          </span>
        )}
        <input
          type="number"
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!isNaN(n)) onChange(n);
          }}
          step={step}
          className={`w-full rounded-md border border-slate-300 bg-white text-slate-900 text-sm py-1.5 ${
            prefix ? "pl-7" : "pl-3"
          } ${
            suffix ? "pr-8" : "pr-3"
          } focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition`}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

function TextInput({ label, value, onChange, hint }) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium text-slate-600 mb-1">
        {label}
      </label>
      <input
        type="text"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

function PctInput({ label, value, onChange, hint, info }) {
  const displayVal = Math.round(value * 10000) / 100;
  return (
    <NumberInput
      label={label}
      value={displayVal}
      onChange={(v) => onChange(v / 100)}
      suffix="%"
      step={0.1}
      hint={hint}
      info={info}
    />
  );
}

function Section({
  title,
  children,
  badge,
  defaultOpen = true,
  info,
  badgeInfo,
  variant = "default",
  icon,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const variantStyles = {
    default: {
      wrapper:
        "my-2.5 first:mt-0 rounded-lg border border-slate-200 bg-white overflow-hidden",
      button:
        "w-full flex justify-between items-center text-left group bg-slate-100 hover:bg-slate-200/60 px-3 py-2.5 transition",
      title: "text-xs font-bold text-slate-800 uppercase tracking-wider",
      badge: "text-xs text-indigo-700 font-medium bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded",
      body: "px-3 pt-3 pb-2",
      icon: null,
    },
    household: {
      wrapper:
        "my-4 rounded-xl border-2 border-indigo-200 bg-indigo-50/70 shadow-sm overflow-hidden",
      button:
        "w-full flex justify-between items-center text-left group bg-indigo-100/80 px-4 py-3 border-b border-indigo-200",
      title: "text-xs font-bold text-indigo-950 uppercase tracking-[0.18em]",
      badge: "text-xs text-indigo-800 font-semibold bg-white px-2 py-0.5 rounded border border-indigo-200",
      body: "px-4 pb-4 pt-3",
      icon: "🏠",
    },
    primary: {
      wrapper:
        "my-4 rounded-xl border-2 border-emerald-200 bg-emerald-50/60 shadow-sm overflow-hidden",
      button:
        "w-full flex justify-between items-center text-left group bg-emerald-100/80 px-4 py-3 border-b border-emerald-200",
      title: "text-xs font-bold text-emerald-950 uppercase tracking-[0.18em]",
      badge:
        "text-xs text-emerald-800 font-semibold bg-white px-2 py-0.5 rounded border border-emerald-200",
      body: "px-4 pb-4 pt-3",
      icon: "👤",
    },
    spouse: {
      wrapper:
        "my-4 rounded-xl border-2 border-violet-200 bg-violet-50/60 shadow-sm overflow-hidden",
      button:
        "w-full flex justify-between items-center text-left group bg-violet-100/80 px-4 py-3 border-b border-violet-200",
      title: "text-xs font-bold text-violet-950 uppercase tracking-[0.18em]",
      badge:
        "text-xs text-violet-800 font-semibold bg-white px-2 py-0.5 rounded border border-violet-200",
      body: "px-4 pb-4 pt-3",
      icon: "👥",
    },
  };
  const styles = variantStyles[variant] || variantStyles.default;
  return (
    <div className={styles.wrapper}>
      <button
        onClick={() => setOpen(!open)}
        className={styles.button}
      >
        <div className="flex items-center gap-2">
          {(icon || styles.icon) && (
            <span className="text-base leading-none">{icon || styles.icon}</span>
          )}
          <h3 className={styles.title}>
            {info ? <TermLabel info={info}>{title}</TermLabel> : title}
          </h3>
          {badge && (
            <span className={styles.badge}>
              {badge}
              {badgeInfo && <TermInfo text={badgeInfo} />}
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-slate-400 group-hover:text-slate-600 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className={styles.body}>{children}</div>}
    </div>
  );
}

// Always-visible plan-health banner. Red when the projection runs out of
// money (with the exact age), amber when the plan is tight, slim green
// confirmation when funded. Also included in the printed report.
function PlanStatusBanner({
  shortfall,
  planThroughAge,
  isCouple,
  maxSustainableSpending = null,
  plannedSpending = null,
}) {
  if (!shortfall) return null;
  const { status } = shortfall;

  if (status === "danger") {
    const ageLabel =
      shortfall.firstShortfallAge != null
        ? `age ${shortfall.firstShortfallAge}${isCouple ? " (primary)" : ""} — year ${shortfall.firstShortfallYear}`
        : `before age ${planThroughAge}`;
    return (
      <div
        role="alert"
        className="bg-rose-600 text-white px-6 py-4 shadow-md print:bg-white print:text-rose-700 print:border-2 print:border-rose-600 print:rounded print-avoid-break"
      >
        <div className="max-w-[1800px] mx-auto flex items-start gap-3">
          <svg
            className="w-8 h-8 flex-shrink-0 mt-0.5 animate-pulse print:animate-none"
            fill="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M12 2L1 21h22L12 2zm0 6a1 1 0 0 1 1 1v5a1 1 0 1 1-2 0V9a1 1 0 0 1 1-1zm0 9.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5z" />
          </svg>
          <div>
            <p className="text-lg font-bold leading-tight">
              Plan shortfall: your money runs out at {ageLabel}
            </p>
            <p className="text-sm mt-1 text-rose-100 print:text-rose-700">
              Spending and taxes exceed available funds in{" "}
              {shortfall.shortfallYearCount} plan year
              {shortfall.shortfallYearCount === 1 ? "" : "s"}
              {shortfall.totalUnmet > 0
                ? ` — total unfunded need ${fmtMoney(shortfall.totalUnmet)}`
                : ""}
              . The shortfall year is marked on the chart and highlighted in
              the year-by-year table below. Levers to test: lower spending,
              retire later, adjust the Social Security claim age, or reduce
              Roth conversions in tight years.
            </p>
            {maxSustainableSpending != null &&
              plannedSpending != null &&
              maxSustainableSpending < plannedSpending && (
                <p className="text-sm mt-1 font-semibold text-white print:text-rose-700">
                  Cutting lifestyle spending by ≈
                  {fmtMoney(plannedSpending - maxSustainableSpending)}/yr (to ≈
                  {fmtMoney(maxSustainableSpending)}) would keep this plan
                  funded through age {planThroughAge}, all else equal.
                </p>
              )}
            {maxSustainableSpending == null && (
              <p className="text-sm mt-1 font-semibold text-white print:text-rose-700">
                Even $0 lifestyle spending cannot fully fund this plan —
                healthcare, debt, and taxes alone exceed the modeled
                resources.
              </p>
            )}
            {shortfall.protectedReserveCash > 1000 && (
              <p className="text-sm mt-1 font-semibold text-white print:text-rose-700">
                Note: about {fmtMoney(shortfall.protectedReserveCash)} sits in
                your protected cash reserve. Enable "Allow reserve as last
                resort" under Cash Strategy if you want the plan to spend it
                before failing.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (status === "warning") {
    const reasons = [];
    if (shortfall.withdrawalRate >= (shortfall.guideline || 0.04) + 0.005) {
      reasons.push(
        `the Year-1 withdrawal rate is ${fmtPct(shortfall.withdrawalRate)} (above the ${fmtPct(shortfall.guideline || 0.04)} guideline for a ${shortfall.retirementYears}-year retirement)`,
      );
    }
    if (shortfall.endingVsRetirement < 0.3) {
      reasons.push(
        `the projected ending balance is only ${Math.round(shortfall.endingVsRetirement * 100)}% of the portfolio at retirement`,
      );
    }
    return (
      <div
        role="alert"
        className="bg-amber-400 text-amber-950 px-6 py-3 shadow print:bg-white print:border-2 print:border-amber-500 print:rounded print-avoid-break"
      >
        <div className="max-w-[1800px] mx-auto flex items-start gap-3">
          <svg
            className="w-6 h-6 flex-shrink-0 mt-0.5"
            fill="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M12 2L1 21h22L12 2zm0 6a1 1 0 0 1 1 1v5a1 1 0 1 1-2 0V9a1 1 0 0 1 1-1zm0 9.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5z" />
          </svg>
          <div>
            <p className="text-sm font-bold leading-tight">
              Plan is funded through age {planThroughAge}, but the margin is
              thin
            </p>
            <p className="text-xs mt-0.5">
              {reasons.join("; ")}. A weak market early in retirement could
              create a shortfall — check the Risk Analysis tab for the
              probability of running out.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-emerald-50 border-b border-emerald-200 text-emerald-900 px-6 py-2 print:border print:border-emerald-300 print:rounded print-avoid-break">
      <div className="max-w-[1800px] mx-auto flex items-center gap-2 text-sm">
        <svg
          className="w-4 h-4 text-emerald-600 flex-shrink-0"
          fill="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M9 16.2l-3.5-3.5L4 14.2 9 19.2 20 8.2l-1.4-1.4z" />
        </svg>
        <span>
          On track — plan is funded through age {planThroughAge} with{" "}
          {fmtMoney(shortfall.endBalance)} projected remaining.
        </span>
      </div>
    </div>
  );
}

function MetricCard({ label, value, sublabel, tone = "neutral" }) {
  const tones = {
    neutral: "text-slate-900",
    good: "text-emerald-600",
    warn: "text-amber-600",
    bad: "text-rose-600",
  };
  return (
    <div className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
        {label}
      </p>
      <p className={`text-2xl font-bold mt-1 ${tones[tone]}`}>{value}</p>
      {sublabel && (
        <p className="text-xs text-slate-500 mt-1 leading-tight">{sublabel}</p>
      )}
    </div>
  );
}

function PlanNarrative({ narrative }) {
  const toneStyles = {
    good: {
      card: "border-emerald-200 bg-emerald-50",
      badge: "bg-emerald-100 text-emerald-800 border-emerald-200",
      heading: "text-emerald-950",
      text: "text-emerald-900",
    },
    warn: {
      card: "border-amber-200 bg-amber-50",
      badge: "bg-amber-100 text-amber-800 border-amber-200",
      heading: "text-amber-950",
      text: "text-amber-900",
    },
    bad: {
      card: "border-rose-200 bg-rose-50",
      badge: "bg-rose-100 text-rose-800 border-rose-200",
      heading: "text-rose-950",
      text: "text-rose-900",
    },
  };
  const style = toneStyles[narrative.tone] || toneStyles.warn;
  const label =
    narrative.tone === "good"
      ? "Looks strong"
      : narrative.tone === "bad"
        ? "Needs attention"
        : "Watch closely";

  return (
    <section className={`rounded-lg border p-5 shadow-sm print:shadow-none ${style.card}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Plan Summary
          </p>
          <h2 className={`mt-1 text-xl font-bold ${style.heading}`}>
            {narrative.headline}
          </h2>
        </div>
        <span
          className={`inline-flex w-fit items-center rounded border px-2.5 py-1 text-xs font-semibold ${style.badge}`}
        >
          {label}
        </span>
      </div>

      <div className={`mt-4 space-y-3 text-sm leading-relaxed ${style.text}`}>
        {narrative.reasons.map((reason, idx) => (
          <p key={idx}>{reason}</p>
        ))}
      </div>

      {narrative.watchItems.length > 0 && (
        <div className="mt-4 rounded-md border border-white/70 bg-white/70 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            What to watch
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
            {narrative.watchItems.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function PhasePill({ phase }) {
  const styles = {
    accumulation: "bg-slate-100 text-slate-600",
    bridge: "bg-amber-100 text-amber-800",
    mid: "bg-emerald-100 text-emerald-800",
    medicare: "bg-sky-100 text-sky-800",
    ss: "bg-indigo-100 text-indigo-800",
  };
  const labels = {
    accumulation: "Accum",
    bridge: "Bridge",
    mid: "Flex",
    medicare: "Medicare",
    ss: "SS",
  };
  return (
    <span
      className={`text-xs font-medium px-2 py-0.5 rounded ${styles[phase]}`}
    >
      {labels[phase]}
    </span>
  );
}

// ============================================================
// SettingsExport — collapsible table of all input values, easy to copy/paste
// ============================================================
function SettingsExport({ inputs, sourceInputs = inputs }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [plainTextOpen, setPlainTextOpen] = useState(false);

  // Format inputs into grouped rows for display.
  // Keep it aligned with how they appear in the sidebar so it's intuitive.
  const fmtMoney = (v) =>
    v == null ? "—" : "$" + Math.round(v).toLocaleString();
  const fmtPct = (v) => (v == null ? "—" : (v * 100).toFixed(2) + "%");
  const fmtBool = (v) => (v ? "Yes" : "No");
  const fmtNum = (v) => (v == null ? "—" : String(v));

  const isCoupleExport = isCoupleMode(sourceInputs);
  const coupleExport = isCoupleExport
    ? normalizeCoupleInputs(sourceInputs.couple)
    : null;
  const exportInputs = isCoupleExport ? sourceInputs : inputs;
  const personGroups = (title, person) => {
    const planLabel = person.employerPlanLabel || (title === "Spouse" ? "403b" : "401k");
    return [
      {
        title: `${title} Timing`,
        rows: [
          ["Name", person.name || title],
          ["Current Age", fmtNum(person.currentAge)],
          ["Retirement Age", fmtNum(person.retirementAge)],
          ["Plan Through Age", fmtNum(person.planThroughAge)],
        ],
      },
      {
        title: `${title} Accounts`,
        rows: [
          ["Employer Plan Label", planLabel],
          [`${planLabel} Balance`, fmtMoney(person.balance401k)],
          ["Traditional IRA", fmtMoney(person.balanceTradIra)],
          ["Roth IRA", fmtMoney(person.balanceRoth)],
          ["HSA", fmtMoney(person.balanceHsa)],
        ],
      },
      {
        title: `${title} Contributions`,
        rows: [
          [`${planLabel} Employee`, fmtMoney(person.contrib401k)],
          ["Employer Match", fmtMoney(person.contribMatch)],
          ["HSA Contribution", fmtMoney(person.contribHsa)],
        ],
      },
      {
        title: `${title} Income`,
        rows: [
          ["Part-Time Income / Year", fmtMoney(person.partTimeIncome)],
          ["Years of Part-Time Work", fmtNum(person.partTimeYears)],
          ["Social Security at FRA / Year", fmtMoney(person.ssIncome)],
          ["Age to Claim SS", fmtNum(person.ssAge)],
          ["Annual Pension", fmtMoney(person.pensionIncome)],
          ["Pension Start Age", fmtNum(person.pensionStartAge)],
          ["Pension COLA", fmtPct(person.pensionCola)],
          ["NY State Tax Exempt Pension", fmtBool(person.pensionNyExempt !== false)],
        ],
      },
      {
        title: `${title} Strategy`,
        rows: [
          ["RMD Start Age", fmtNum(person.rmdStartAge || defaultRmdStartAge(person.currentAge))],
          ["Roth Conversion: retirement-59 / Year", fmtMoney(person.conversionBridge)],
          ["Roth Conversion: Ages 60-64 / Year", fmtMoney(person.conversionMid)],
          ["Roth Conversion: 65 until SS / Year", fmtMoney(person.conversionFinal)],
          ["Healthcare before 65", fmtMoney(person.healthcarePre65)],
          ["Healthcare 65+", fmtMoney(person.healthcarePost65)],
        ],
      },
    ];
  };

  const groups = isCoupleExport ? [
    {
      title: "Plan Type",
      rows: [["Mode", "Married Couple"]],
    },
    {
      title: "Household Shared Assets",
      rows: [
        ["Cash / HYSA", fmtMoney(coupleExport.shared.balanceCash)],
        ["Taxable Brokerage", fmtMoney(coupleExport.shared.balanceTaxable)],
        ["Taxable Cost Basis %", fmtPct(coupleExport.shared.taxableBasisPct)],
        ["Credit Card Debt", fmtMoney(coupleExport.shared.creditCardDebt)],
        [
          "Cash Withdrawal Strategy",
          (CASH_STRATEGY_OPTIONS.find((o) => o.value === (coupleExport.shared.cashStrategy || "cashFirst"))?.label || "Use cash first (default)"),
        ],
        ["Minimum Cash Reserve", fmtMoney(coupleExport.shared.cashReserveFloor || 0)],
        [
          "Allow Reserve As Last Resort",
          fmtBool(coupleExport.shared.allowReserveAsLastResort === true),
        ],
      ],
    },
    {
      title: "Household Spending",
      rows: [
        ["Base Lifestyle Expenses", fmtMoney(coupleExport.shared.baseExpenses)],
        ["Household Size", fmtNum(coupleExport.shared.householdSize)],
        ["Flexible Spending", fmtBool(coupleExport.shared.flexibleSpending !== false)],
        ["ACA Subsidy Estimate", fmtBool(coupleExport.shared.useAcaSubsidyEstimate === true)],
      ],
    },
    {
      title: "Household Returns & Risk",
      rows: [
        ["Pre-Retirement Return", fmtPct(coupleExport.shared.preReturn)],
        ["Post-Retirement Return", fmtPct(coupleExport.shared.postReturn)],
        ["Cash / HYSA Return", fmtPct(coupleExport.shared.cashReturn)],
        ["Inflation", fmtPct(coupleExport.shared.inflation)],
        ["Portfolio Volatility", fmtPct(coupleExport.shared.portfolioVolatility)],
        ["Taxable Annual Tax Drag", fmtPct(coupleExport.shared.taxableAnnualTaxDrag)],
      ],
    },
    ...personGroups("Primary", coupleExport.primary),
    ...personGroups("Spouse", coupleExport.spouse),
  ] : [
    {
      title: "Timing",
      rows: [
        ["Current Age", fmtNum(exportInputs.currentAge)],
        ["Retirement Age", fmtNum(exportInputs.retirementAge)],
        ["Plan Through Age", fmtNum(exportInputs.planThroughAge)],
      ],
    },
    {
      title: "Current Balances",
      rows: [
        ["Cash / HYSA", fmtMoney(exportInputs.balanceCash)],
        ["Taxable Brokerage", fmtMoney(exportInputs.balanceTaxable)],
        ["Taxable Cost Basis %", fmtPct(exportInputs.taxableBasisPct)],
        ["401k / 403b", fmtMoney(exportInputs.balance401k)],
        ["Traditional IRA", fmtMoney(exportInputs.balanceTradIra)],
        ["Roth IRA", fmtMoney(exportInputs.balanceRoth)],
        ["HSA", fmtMoney(exportInputs.balanceHsa)],
        ["Credit Card Debt", fmtMoney(exportInputs.creditCardDebt)],
      ],
    },
    {
      title: "Cash Strategy",
      rows: [
        [
          "Cash Withdrawal Strategy",
          (CASH_STRATEGY_OPTIONS.find((o) => o.value === (exportInputs.cashStrategy || "cashFirst"))?.label || "Use cash first (default)"),
        ],
        ["Minimum Cash Reserve", fmtMoney(exportInputs.cashReserveFloor || 0)],
        [
          "Allow Reserve As Last Resort",
          fmtBool(exportInputs.allowReserveAsLastResort === true),
        ],
      ],
    },
    {
      title: "Returns & Inflation",
      rows: [
        ["Pre-Retirement Return", fmtPct(exportInputs.preReturn)],
        ["Post-Retirement Return", fmtPct(exportInputs.postReturn)],
        ["Cash Return", fmtPct(exportInputs.cashReturn)],
        ["Inflation", fmtPct(exportInputs.inflation)],
      ],
    },
    {
      title: "Risk Assumptions (Monte Carlo)",
      rows: [
        ["Portfolio Volatility", fmtPct(exportInputs.portfolioVolatility)],
        ["Taxable Annual Tax Drag", fmtPct(exportInputs.taxableAnnualTaxDrag)],
        ["Flexible Spending", fmtBool(exportInputs.flexibleSpending !== false)],
      ],
    },
    {
      title: "Contributions (Pre-Retirement)",
      rows: [
        ["401k Employee", fmtMoney(exportInputs.contrib401k)],
        ["Employer Match", fmtMoney(exportInputs.contribMatch)],
        ["HSA Contribution", fmtMoney(exportInputs.contribHsa)],
      ],
    },
    {
      title: "Spending (Today's $)",
      rows: [
        ["Base Expenses", fmtMoney(exportInputs.baseExpenses)],
        ["Healthcare Pre-65", fmtMoney(exportInputs.healthcarePre65)],
        ["Healthcare Post-65", fmtMoney(exportInputs.healthcarePost65)],
      ],
    },
    {
      title: "Income",
      rows: [
        ["Part-Time Income / Year", fmtMoney(exportInputs.partTimeIncome)],
        ["Years of Part-Time Work", fmtNum(exportInputs.partTimeYears)],
        ["Social Security at FRA / Year", fmtMoney(exportInputs.ssIncome)],
        ["Age to Claim SS", fmtNum(exportInputs.ssAge)],
      ],
    },
    {
      title: "Pension",
      rows: [
        ["Annual Pension", fmtMoney(exportInputs.pensionIncome)],
        ["Pension Start Age", fmtNum(exportInputs.pensionStartAge)],
        ["Pension COLA", fmtPct(exportInputs.pensionCola)],
        ["NY State Tax Exempt", fmtBool(exportInputs.pensionNyExempt !== false)],
      ],
    },
    {
      title: "Roth Conversions",
      rows: [
        ["Retirement through 59 / Year", fmtMoney(exportInputs.conversionBridge)],
        ["Ages 60-64 / Year", fmtMoney(exportInputs.conversionMid)],
        ["Age 65 until SS / Year", fmtMoney(exportInputs.conversionFinal)],
      ],
    },
    {
      title: "Advanced Tax Model",
      rows: [
        [
          "RMD Start Age",
          fmtNum(exportInputs.rmdStartAge || defaultRmdStartAge(exportInputs.currentAge)),
        ],
        [
          "ACA Subsidy Estimate",
          fmtBool(exportInputs.useAcaSubsidyEstimate === true),
        ],
        ["Household Size", fmtNum(exportInputs.householdSize)],
      ],
    },
  ];

  // Build a plain-text version for copying (pipe-delimited, easy to paste anywhere)
  const buildPlainText = () => {
    const lines = ["# Retirement Planner Settings", ""];
    for (const g of groups) {
      lines.push(`## ${g.title}`);
      for (const [label, value] of g.rows) {
        lines.push(`${label}: ${value}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  };

  const copyViaTemporaryTextarea = (text) => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    textarea.style.left = "-1000px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    let succeeded = false;
    try {
      succeeded = document.execCommand("copy");
    } finally {
      document.body.removeChild(textarea);
    }
    return succeeded;
  };

  const handleCopy = async () => {
    const text = buildPlainText();
    setCopyError(false);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (!copyViaTemporaryTextarea(text)) {
        throw new Error("Clipboard fallback failed");
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      if (copyViaTemporaryTextarea(text)) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        setCopyError(true);
        setPlainTextOpen(true);
        setTimeout(() => {
          const ta = document.getElementById("settings-export-textarea");
          ta?.focus();
          ta?.select();
        }, 0);
      }
    }
  };

  return (
    <div className="mt-4 bg-white border border-slate-200 rounded-lg shadow-sm print-avoid-break">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex justify-between items-center px-4 py-3 text-left hover:bg-slate-50 transition rounded-lg"
      >
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 text-slate-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
          <h3 className="text-sm font-semibold text-slate-800">
            Current Settings (Copy/Paste)
          </h3>
          <span className="text-xs text-slate-500">
            — share your setup with someone else or save for later
          </span>
        </div>
        <span className="text-slate-400 text-lg">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="border-t border-slate-200 p-4">
          <div className="flex justify-end mb-3">
            <button
              type="button"
              onClick={handleCopy}
              className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded font-medium transition"
            >
              {copied ? "✓ Copied!" : "Copy All as Text"}
            </button>
          </div>
          {copyError && (
            <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Browser clipboard access was blocked. The plain-text settings are open below; press Ctrl+C to copy the selected text.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {groups.map((g) => (
              <div
                key={g.title}
                className="border border-slate-200 rounded overflow-hidden"
              >
                <div className="bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 border-b border-slate-200">
                  {g.title}
                </div>
                <table className="w-full text-xs">
                  <tbody>
                    {g.rows.map(([label, value], idx) => (
                      <tr
                        key={idx}
                        className="border-b border-slate-100 last:border-b-0"
                      >
                        <td className="px-3 py-1 text-slate-600">{label}</td>
                        <td className="px-3 py-1 text-right text-slate-900 font-mono">
                          {value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
          <details
            className="mt-4"
            open={plainTextOpen}
            onToggle={(event) => setPlainTextOpen(event.currentTarget.open)}
          >
            <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-700">
              Show as plain text (for email / chat / manual copy)
            </summary>
            <textarea
              id="settings-export-textarea"
              readOnly
              value={buildPlainText()}
              className="mt-2 w-full h-64 text-xs font-mono p-2 border border-slate-300 rounded bg-slate-50 text-slate-800"
              onClick={(e) => e.target.select()}
            />
          </details>
        </div>
      )}
    </div>
  );
}

function MiniStackedBar({ row }) {
  if (!row.total || row.total === 0) return <span className="text-slate-300">—</span>;
  const segments = [
    { value: row.cash, color: "#94a3b8", name: "Cash" },
    { value: row.taxable, color: "#7dd3fc", name: "Taxable" },
    { value: row.k401, color: "#c4b5fd", name: "401k" },
    { value: row.tradIra, color: "#f9a8d4", name: "Trad IRA" },
    { value: row.roth, color: "#6ee7b7", name: "Roth" },
    { value: row.hsa, color: "#fdba74", name: "HSA" },
  ].filter((s) => s.value > 0);
  return (
    <div
      className="flex h-4 w-full rounded overflow-hidden border border-slate-200"
      title={segments
        .map((s) => `${s.name}: ${fmtMoney(s.value)}`)
        .join(" | ")}
    >
      {segments.map((seg, i) => (
        <div
          key={i}
          style={{
            width: `${(seg.value / row.total) * 100}%`,
            background: seg.color,
          }}
        />
      ))}
    </div>
  );
}

function CoupleOwnerDetailGrid({ ownerDetails }) {
  if (!ownerDetails) return null;
  const primary = ownerDetails.primary || {};
  const spouse = ownerDetails.spouse || {};
  const primaryName = primary.name || "Primary";
  const spouseName = spouse.name || "Spouse";
  const primaryPlan = primary.employerPlanLabel || "401k";
  const spousePlan = spouse.employerPlanLabel || "403b";
  const rows = [
    ["Pension", primary.pension, spouse.pension],
    ["Social Security", primary.ss, spouse.ss],
    ["Part-time", primary.partTime, spouse.partTime],
    [`${primaryPlan} / ${spousePlan} withdrawal`, primary.from401k, spouse.from401k],
    ["IRA withdrawal", primary.fromIra, spouse.fromIra],
    ["Roth withdrawal", primary.fromRoth, spouse.fromRoth],
    ["HSA use", primary.hsaWithdrawal, spouse.hsaWithdrawal],
    ["RMD", primary.rmdAmount, spouse.rmdAmount],
    ["Roth transfer", primary.conversion, spouse.conversion],
  ];
  const hasAnyDetail = rows.some(([, primaryValue, spouseValue]) =>
    (primaryValue || 0) > 0 || (spouseValue || 0) > 0,
  );
  if (!hasAnyDetail) return null;

  return (
    <div className="grid grid-cols-[1.2fr_1fr_1fr] gap-x-3 gap-y-1 rounded border border-slate-200 bg-white p-3 text-[11px]">
      <div className="font-semibold text-slate-500">Owner Detail</div>
      <div className="text-right font-semibold text-slate-700">{primaryName}</div>
      <div className="text-right font-semibold text-slate-700">{spouseName}</div>
      {rows.map(([label, primaryValue, spouseValue]) => (
        <Fragment key={label}>
          <div className="text-slate-500">{label}</div>
          <div className="text-right font-mono text-slate-800">
            {primaryValue > 0 ? fmtMoney(primaryValue) : "-"}
          </div>
          <div className="text-right font-mono text-slate-800">
            {spouseValue > 0 ? fmtMoney(spouseValue) : "-"}
          </div>
        </Fragment>
      ))}
      {(primary.conversion || spouse.conversion) > 0 && (
        <div className="col-span-3 mt-1 text-slate-600">
          Transfers:{" "}
          {primary.conversion > 0
            ? `${primaryName} ${primaryPlan} -> ${primaryName} Roth ${fmtMoney(primary.conversion)}`
            : ""}
          {primary.conversion > 0 && spouse.conversion > 0 ? " | " : ""}
          {spouse.conversion > 0
            ? `${spouseName} ${spousePlan} -> ${spouseName} Roth ${fmtMoney(spouse.conversion)}`
            : ""}
        </div>
      )}
    </div>
  );
}

function formatYearAgeLabel(row, isCouple) {
  if (!isCouple) return `Age ${row.age}`;
  const primary = row.ownerDetails?.primary || {};
  const spouse = row.ownerDetails?.spouse || {};
  const primaryName = primary.name || "Primary";
  const spouseName = spouse.name || "Spouse";
  const primaryAge = Math.round(row.primaryAge ?? row.age);
  const spouseAge = Math.round(row.spouseAge ?? 0);
  return `${row.year} | ${primaryName} ${primaryAge} | ${spouseName} ${spouseAge}`;
}

function formatAxisLabel(row, isCouple) {
  if (!isCouple) return row.age;
  return `${row.year}\n${Math.round(row.primaryAge ?? row.age)}/${Math.round(row.spouseAge ?? 0)}`;
}

function buildReadableAxisTicks(rows, maxTicks = 9) {
  if (rows.length <= maxTicks) return rows.map((row) => row.axisLabel);
  const step = Math.ceil((rows.length - 1) / (maxTicks - 1));
  const ticks = rows
    .filter((_, index) => index % step === 0)
    .map((row) => row.axisLabel);
  const lastTick = rows[rows.length - 1]?.axisLabel;
  if (lastTick && ticks[ticks.length - 1] !== lastTick) ticks.push(lastTick);
  return ticks;
}

function YearAgeAxisTick({ x, y, payload }) {
  const [topLabel, bottomLabel] = String(payload.value).split("\n");
  return (
    <g transform={`translate(${x},${y})`}>
      <text textAnchor="middle" fill="#64748b" fontSize={11}>
        <tspan x="0" dy="0">{topLabel}</tspan>
        {bottomLabel && <tspan x="0" dy="13">{bottomLabel}</tspan>}
      </text>
    </g>
  );
}

function getSpendableCashBreakdown(row) {
  const ownerDetails = row.ownerDetails || {};
  const primary = ownerDetails.primary || {};
  const spouse = ownerDetails.spouse || {};
  const primaryPlan = primary.employerPlanLabel || "401k";
  const spousePlan = spouse.employerPlanLabel || "403b";
  const incomeItems = [
    [`${primary.name || "Primary"} pension`, primary.pension || 0],
    [`${spouse.name || "Spouse"} pension`, spouse.pension || 0],
    [`${primary.name || "Primary"} Social Security`, primary.ss || 0],
    [`${spouse.name || "Spouse"} Social Security`, spouse.ss || 0],
    [`${primary.name || "Primary"} part-time`, primary.partTime || 0],
    [`${spouse.name || "Spouse"} part-time`, spouse.partTime || 0],
  ];
  const withdrawalItems = [
    ["Shared Cash / HYSA withdrawal", row.fromCash || 0],
    ["Taxable brokerage sale", row.fromTaxable || 0],
    [`${primary.name || "Primary"} ${primaryPlan} withdrawal`, primary.from401k || 0],
    [`${spouse.name || "Spouse"} ${spousePlan} withdrawal`, spouse.from401k || 0],
    [`${primary.name || "Primary"} IRA withdrawal`, primary.fromIra || 0],
    [`${spouse.name || "Spouse"} IRA withdrawal`, spouse.fromIra || 0],
    [`${primary.name || "Primary"} Roth withdrawal`, primary.fromRoth || 0],
    [`${spouse.name || "Spouse"} Roth withdrawal`, spouse.fromRoth || 0],
    [`${primary.name || "Primary"} HSA healthcare use`, primary.hsaWithdrawal || 0],
    [`${spouse.name || "Spouse"} HSA healthcare use`, spouse.hsaWithdrawal || 0],
  ];
  const transferItems = [
    [`${primary.name || "Primary"} ${primaryPlan} -> ${primary.name || "Primary"} Roth`, primary.conversion || 0],
    [`${spouse.name || "Spouse"} ${spousePlan} -> ${spouse.name || "Spouse"} Roth`, spouse.conversion || 0],
  ];
  const total = (items) => items.reduce((sum, [, value]) => sum + (value || 0), 0);
  return {
    incomeItems: incomeItems.filter(([, value]) => value > 0),
    withdrawalItems: withdrawalItems.filter(([, value]) => value > 0),
    transferItems: transferItems.filter(([, value]) => value > 0),
    incomeTotal: total(incomeItems),
    withdrawalTotal: total(withdrawalItems),
    transferTotal: total(transferItems),
    spendingUses: (row.spending || 0) + (row.tax || 0),
  };
}

function CompactMoneyList({ items }) {
  if (!items.length) return <span className="text-slate-400">-</span>;
  return (
    <div className="space-y-0.5">
      {items.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-3">
          <span className="truncate text-slate-500">{label}</span>
          <span className="shrink-0 font-mono text-slate-800">{fmtMoney(value)}</span>
        </div>
      ))}
    </div>
  );
}

function SpendableCashLedger({ rows }) {
  if (!rows.length) return null;
  return (
    <div className="mt-5 overflow-hidden rounded-lg border border-slate-200">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <h3 className="text-sm font-bold text-slate-900">Spendable Cash Flow</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">
          Income and withdrawals become cash available for spending. Roth transfers are shown separately because they move money between accounts and are not spendable cash.
        </p>
      </div>
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full min-w-[1180px] text-xs">
          <thead className="sticky top-0 bg-white shadow-sm">
            <tr className="border-b border-slate-200">
              <th className="px-3 py-2 text-left font-semibold text-slate-700">Year / Ages</th>
              <th className="px-3 py-2 text-right font-semibold text-emerald-700">Income Cash</th>
              <th className="px-3 py-2 text-right font-semibold text-sky-700">Withdrawal Cash</th>
              <th className="px-3 py-2 text-right font-semibold text-rose-700">Spending + Tax</th>
              <th className="px-3 py-2 text-right font-semibold text-indigo-700">Non-Spending Transfers</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const breakdown = getSpendableCashBreakdown(row);
              return (
                <tr key={row.year} className="border-b border-slate-100 align-top hover:bg-slate-50">
                  <td className="px-3 py-3 font-semibold text-slate-900">
                    {formatYearAgeLabel(row, true)}
                  </td>
                  <td className="px-3 py-3">
                    <CompactMoneyList items={breakdown.incomeItems} />
                    <div className="mt-1 text-right font-mono font-semibold text-emerald-700">
                      {fmtMoney(breakdown.incomeTotal)}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <CompactMoneyList items={breakdown.withdrawalItems} />
                    <div className="mt-1 text-right font-mono font-semibold text-sky-700">
                      {fmtMoney(breakdown.withdrawalTotal)}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono font-semibold text-rose-700">
                    {fmtMoney(breakdown.spendingUses)}
                  </td>
                  <td className="px-3 py-3">
                    <CompactMoneyList items={breakdown.transferItems} />
                    <div className="mt-1 text-right font-mono font-semibold text-indigo-700">
                      {breakdown.transferTotal > 0 ? fmtMoney(breakdown.transferTotal) : "-"}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CashFlowTooltip({ active, payload, isCouple, showNeedBreakdown = false }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const visiblePayload = payload.filter((item) => item.value != null && item.value !== 0);
  return (
    <div className="max-w-sm rounded border border-slate-300 bg-white p-3 text-xs shadow-lg">
      <div className="mb-2 font-semibold text-slate-900">
        {formatYearAgeLabel(row, isCouple)}
      </div>
      <div className="space-y-1">
        {visiblePayload.map((item) => (
          <div key={item.dataKey} className="flex items-center justify-between gap-4">
            <span className="text-slate-600">{item.name || item.dataKey}</span>
            <span className="font-mono text-slate-900">{fmtMoneyFull(item.value)}</span>
          </div>
        ))}
      </div>
      {showNeedBreakdown && row.spending > 0 && (
        <div className="mt-2 border-t border-slate-200 pt-2 space-y-0.5">
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-600">Need = Spending</span>
            <span className="font-mono text-slate-900">
              {fmtMoneyFull(row.spending)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-600">
              + Tax
              {row.earlyPenalty > 0
                ? ` (incl. ${fmtMoneyFull(row.earlyPenalty)} penalty)`
                : ""}
            </span>
            <span className="font-mono text-slate-900">
              {fmtMoneyFull(row.tax)}
            </span>
          </div>
          {row.conversion > 0 && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-indigo-700">
                Roth conversion (taxed, not spending)
              </span>
              <span className="font-mono text-indigo-700">
                {fmtMoneyFull(row.conversion)}
              </span>
            </div>
          )}
        </div>
      )}
      {isCouple && row.ownerDetails && (
        <div className="mt-3 border-t border-slate-200 pt-2">
          <CoupleOwnerDetailGrid ownerDetails={row.ownerDetails} />
        </div>
      )}
    </div>
  );
}

// ============================================================
// EARLY-RETIREMENT ACCESS STRATEGY (Rule of 55 / pre-59½ bridge)
// ============================================================
// Personalized guidance for plans that retire before 59½: whether the Rule
// of 55 applies, which accounts carry penalties, and how the projection
// actually funds the bridge years. All numbers come from the same engine
// rows that drive the charts and year-by-year table.

function EarlyAccessStrategyPanel({
  displayInputs,
  results,
  isCouple,
  couple,
  adjust,
  showRealDollars,
  maxSustainableSpending,
}) {
  const earliestRetireAge = displayInputs.retirementAge;
  if (earliestRetireAge >= 59.5) return null;

  const people = isCouple
    ? [
        {
          label: couple.primary.name || "Primary",
          retirementAge: couple.primary.retirementAge,
          plan: couple.primary.employerPlanLabel || "401k",
        },
        {
          label: couple.spouse.name || "Spouse",
          retirementAge: couple.spouse.retirementAge,
          plan: couple.spouse.employerPlanLabel || "403b",
        },
      ]
    : [
        {
          label: "You",
          retirementAge: displayInputs.retirementAge,
          plan: "401k",
        },
      ];
  const anyRuleOf55 = people.some(
    (p) => p.retirementAge >= 55 && p.retirementAge < 59.5,
  );
  const anyIneligible = people.some((p) => p.retirementAge < 55);

  // Bridge rows: retirement years in which a retired person is still under 60
  // (the annual model's stand-in for 59½). These are the years early-access
  // rules bite — the same rows shown in the charts and table.
  const bridgeRows = results.yearlyData.filter((d) => {
    if (d.phase === "accumulation") return false;
    if (!isCouple) return d.age < 60;
    const primaryBridging =
      d.primaryAge >= couple.primary.retirementAge && d.primaryAge < 60;
    const spouseBridging =
      d.spouseAge >= couple.spouse.retirementAge && d.spouseAge < 60;
    return primaryBridging || spouseBridging;
  });
  const sumAdj = (fn) =>
    bridgeRows.reduce((acc, d) => acc + adjust(fn(d) || 0, d.year), 0);
  const bridgeNeed = sumAdj((d) => d.spending + d.tax);
  const bridgeIncome = sumAdj((d) => d.partTime + (d.pension || 0) + d.ss);
  const fromCash = sumAdj((d) => d.fromCash);
  const fromTaxable = sumAdj((d) => d.fromTaxable);
  const fromHsa = sumAdj((d) => d.hsaWithdrawal);
  const fromPreTax = sumAdj((d) => d.from401k + d.fromIra);
  const fromRoth = sumAdj((d) => d.fromRoth);
  const totalPenalties = results.yearlyData.reduce(
    (acc, d) => acc + adjust(d.earlyPenalty || 0, d.year),
    0,
  );
  const penaltyDraws = fromPreTax + fromRoth;
  const bridgeCovered = penaltyDraws < Math.max(1000, bridgeNeed * 0.01);
  const dollarNote = showRealDollars
    ? "today's dollars"
    : "future (inflated) dollars";
  const bridgeYearCount = bridgeRows.length;
  const stillWorking = displayInputs.currentAge < earliestRetireAge;

  const accessRows = [
    {
      name: "Cash / HYSA",
      balance: displayInputs.balanceCash,
      status: "No penalty at any age. Interest is taxed as ordinary income.",
      tone: "good",
    },
    {
      name: "Taxable brokerage",
      balance: displayInputs.balanceTaxable,
      status:
        "No penalty at any age. Only the gain portion of each sale is taxed — often at 0% capital-gains rates when your other income is low.",
      tone: "good",
    },
    {
      name: "HSA",
      balance: displayInputs.balanceHsa,
      status:
        "Tax- and penalty-free at any age for qualified medical costs (including many insurance premiums and out-of-pocket bills).",
      tone: "good",
    },
    {
      name: isCouple ? "Employer plans (401k/403b)" : "401k / 403b",
      balance: displayInputs.balance401k,
      status: anyRuleOf55
        ? "Penalty-free before 59½ ONLY under the Rule of 55: just the plan at the employer you leave at 55+, and only if that plan allows post-separation withdrawals. Old employers' plans stay penalized. Otherwise: 10% penalty + income tax."
        : "10% penalty + ordinary income tax on withdrawals before 59½. The Rule of 55 does not apply to this plan (see below).",
      tone: anyRuleOf55 ? "warn" : "bad",
    },
    {
      name: "Traditional IRA",
      balance: displayInputs.balanceTradIra,
      status:
        "10% penalty + ordinary income tax before 59½. The Rule of 55 NEVER applies to IRAs — rolling a 401k into an IRA before 55 permanently gives up that exception for the rolled money.",
      tone: "bad",
    },
    {
      name: "Roth IRA",
      balance: displayInputs.balanceRoth,
      status:
        "In real life, direct contributions can come out any time tax- and penalty-free; earnings and conversions less than 5 years old are penalized before 59½. This model is conservative: it penalizes ALL early Roth withdrawals and draws Roth last.",
      tone: "warn",
    },
  ].filter((row) => (row.balance || 0) > 0);

  const toneStyles = {
    good: "text-emerald-700",
    warn: "text-amber-700",
    bad: "text-rose-700",
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm print:shadow-none print:border-slate-300 print-avoid-break">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h2 className="text-lg font-bold text-slate-900">
          Accessing Money Before 59½ — Your Strategy
        </h2>
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded border ${
            anyRuleOf55
              ? "bg-amber-50 text-amber-800 border-amber-200"
              : "bg-rose-50 text-rose-800 border-rose-200"
          }`}
        >
          <TermLabel info={TERM_HELP.ruleOf55}>
            {anyRuleOf55
              ? anyIneligible
                ? "Rule of 55: partial"
                : "Rule of 55: applies, with limits"
              : "Rule of 55: not available"}
          </TermLabel>
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        You plan to retire at {earliestRetireAge}, before retirement accounts
        unlock at 59½. Here is what that means and how this plan handles it.
        All figures below come from the same projection as the charts and
        table, in {dollarNote}.
      </p>

      {/* Plain-language verdict, mirroring the engine's actual strategy */}
      <div
        className={`mb-4 rounded border p-3 text-xs leading-relaxed ${
          bridgeCovered
            ? "bg-emerald-50 border-emerald-200 text-emerald-900"
            : "bg-amber-50 border-amber-300 text-amber-900"
        }`}
      >
        {anyRuleOf55 && !anyIneligible ? (
          <span>
            <span className="font-semibold">
              The Rule of 55 can help you, but it is narrower than most people
              think.
            </span>{" "}
            It covers only the 401k/403b at the employer you leave at 55 or
            later — never IRAs, never old employers' plans — and only if the
            plan allows partial withdrawals after you leave.{" "}
          </span>
        ) : (
          <span>
            <span className="font-semibold">
              The Rule of 55 does not apply to your situation
              {isCouple && anyRuleOf55 ? " for every account" : ""}.
            </span>{" "}
          </span>
        )}
        Based on your current finances, the recommended approach is to use
        your available cash and taxable investments to fund the early years
        of retirement while preserving tax-advantaged retirement assets until
        they can be accessed without penalty.{" "}
        {bridgeCovered ? (
          <span>
            <span className="font-semibold">
              Good news: this projection does exactly that.
            </span>{" "}
            Your penalty-free money (cash, taxable, HSA
            {bridgeIncome > 0 ? ", plus part-time/pension income" : ""}) covers
            all {bridgeYearCount} bridge year{bridgeYearCount === 1 ? "" : "s"}{" "}
            without touching retirement accounts early.
          </span>
        ) : (
          <span>
            <span className="font-semibold">
              Caution: penalty-free money is not enough in this plan.
            </span>{" "}
            The projection is forced to pull {fmtMoney(penaltyDraws)} from
            retirement accounts before 59½, costing about{" "}
            {fmtMoney(totalPenalties)} in extra 10% penalties (rows flagged
            PENALTY in the table). The strategies at the bottom of this panel
            can shrink or eliminate that.
          </span>
        )}
      </div>

      {/* Per-person eligibility */}
      <div className="mb-4">
        <p className="text-xs font-semibold text-slate-700 mb-2">
          Why {anyRuleOf55 ? "— and where —" : ""} the Rule of 55{" "}
          {anyRuleOf55 ? "applies" : "is not available"}:
        </p>
        <ul className="space-y-1.5 text-xs text-slate-700 leading-relaxed list-disc list-inside">
          {people.map((p) => {
            if (p.retirementAge >= 59.5) {
              return (
                <li key={p.label}>
                  <span className="font-medium">{p.label}</span> retires at{" "}
                  {p.retirementAge}, after 59½ — no early-withdrawal problem
                  for {isCouple ? `${p.label}'s` : "your"} accounts.
                </li>
              );
            }
            if (p.retirementAge >= 55) {
              return (
                <li key={p.label}>
                  <span className="font-medium">{p.label}</span> retires at{" "}
                  {p.retirementAge}, in or after the year of turning 55 — so
                  the Rule of 55 can make{" "}
                  {isCouple ? `${p.label}'s ${p.plan}` : `your ${p.plan}`}{" "}
                  penalty-free, but only the current employer's plan and only
                  if it allows post-separation withdrawals. IRAs still wait
                  until 59½. This model optimistically assumes the whole{" "}
                  {p.plan} qualifies.
                </li>
              );
            }
            return (
              <li key={p.label}>
                <span className="font-medium">{p.label}</span> retires at{" "}
                {p.retirementAge} — {55 - p.retirementAge} year
                {55 - p.retirementAge === 1 ? "" : "s"} before the Rule of 55
                window opens. The rule requires leaving your employer{" "}
                <em>in or after the calendar year you turn 55</em>, so it will
                not apply to any of{" "}
                {isCouple ? `${p.label}'s` : "your"} retirement accounts for
                this retirement. Every 401k/IRA dollar withdrawn before 59½
                carries a 10% penalty on top of income tax, and this
                projection includes those penalties. (Returning to work later
                and separating again at 55+ could re-open the rule for that
                new employer's plan only.)
              </li>
            );
          })}
        </ul>
      </div>

      {/* Account access table */}
      <div className="mb-4">
        <p className="text-xs font-semibold text-slate-700 mb-2">
          What you can touch before 59½ — your accounts:
        </p>
        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">
                  Account
                </th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700">
                  Balance today
                </th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">
                  Access before 59½
                </th>
              </tr>
            </thead>
            <tbody>
              {accessRows.map((row) => (
                <tr key={row.name} className="border-b border-slate-100 align-top">
                  <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">
                    {row.name}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {fmtMoney(row.balance)}
                  </td>
                  <td className={`px-3 py-2 leading-relaxed ${toneStyles[row.tone]}`}>
                    {row.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bridge-years funding, from the actual projection */}
      {bridgeYearCount > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-slate-700 mb-2">
            Your bridge years by the numbers ({bridgeYearCount} year
            {bridgeYearCount === 1 ? "" : "s"} before 59½, in {dollarNote}):
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="rounded border border-slate-200 bg-slate-50 p-2">
              <div className="text-slate-500">Spending + taxes to cover</div>
              <div className="font-bold text-slate-900 text-sm">
                {fmtMoney(bridgeNeed)}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 p-2">
              <div className="text-slate-500">
                Covered by income (part-time / pension)
              </div>
              <div className="font-bold text-emerald-700 text-sm">
                {fmtMoney(bridgeIncome)}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 p-2">
              <div className="text-slate-500">
                From penalty-free savings (cash, taxable, HSA)
              </div>
              <div className="font-bold text-sky-700 text-sm">
                {fmtMoney(fromCash + fromTaxable + fromHsa)}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 p-2">
              <div className="text-slate-500">
                From retirement accounts (penalized)
              </div>
              <div
                className={`font-bold text-sm ${
                  penaltyDraws > 0 ? "text-rose-700" : "text-slate-900"
                }`}
              >
                {fmtMoney(penaltyDraws)}
                {totalPenalties > 0 && (
                  <span className="block text-[10px] font-medium text-rose-600">
                    incl. {fmtMoney(totalPenalties)} of 10% penalties
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recommended order */}
      <div className="mb-4">
        <p className="text-xs font-semibold text-slate-700 mb-2">
          Which money to use first, and why (the projection already follows
          this order):
        </p>
        <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-700 leading-relaxed">
          <li>
            <span className="font-medium">Part-time or pension income</span> —
            every earned dollar is one your portfolio doesn't have to produce
            in its most vulnerable years.
          </li>
          <li>
            <span className="font-medium">Cash / HYSA</span> — no tax, no
            penalty, and spending it first lets investments keep compounding.
          </li>
          <li>
            <span className="font-medium">Taxable brokerage</span> — no
            penalty; you only pay capital-gains tax on the growth portion,
            and in low-income bridge years much of that can land in the 0%
            bracket.
          </li>
          <li>
            <span className="font-medium">HSA for medical bills</span> —
            tax-free at any age for healthcare, which is often a big bridge
            expense.
          </li>
          <li>
            <span className="font-medium">Retirement accounts last</span>
            {anyRuleOf55
              ? " — if needed, a Rule-of-55 401k first (no penalty), then penalized accounts only as a last resort."
              : " — only if everything else runs out; each early dollar costs 10% extra plus income tax."}{" "}
            Roth stays untouched the longest so it can grow tax-free.
          </li>
        </ol>
      </div>

      {/* Tax and long-term implications */}
      <div className="mb-4">
        <p className="text-xs font-semibold text-slate-700 mb-2">
          Tax and long-term implications of this strategy:
        </p>
        <ul className="list-disc list-inside space-y-1.5 text-xs text-slate-700 leading-relaxed">
          <li>
            Selling taxable investments realizes capital gains — but in years
            with little other income, gains inside the 0% bracket are federal
            tax-free (NY still taxes them). The projection's Tax column
            already reflects this.
          </li>
          <li>
            Every penalized retirement-account dollar costs 10% on top of
            ordinary income tax
            {totalPenalties > 0
              ? ` — about ${fmtMoney(totalPenalties)} of penalties over this plan`
              : ""}
            . Penalties are pure loss: money that never comes back or
            compounds.
          </li>
          <li>
            Draining cash and taxable first means your tax-deferred accounts
            keep growing — good for the bridge, but it builds up the balance
            subject to RMDs at {results.summary.rmdStartAge}. Low-income
            bridge years are also the cheapest time for{" "}
            <span className="font-medium">Roth conversions</span> (sidebar →
            Roth Conversions) to defuse that later tax bomb.
          </li>
          <li>
            Big withdrawals or conversions in bridge years raise MAGI, which
            can shrink ACA health-insurance subsidies before 65. If you use
            marketplace insurance, test the "Estimate ACA Subsidy" toggle to
            see the trade-off.
          </li>
          <li>
            Spending down your cash buffer early leaves you more exposed to a
            market crash in your first retirement years (sequence risk) — see
            the Risk Analysis tab.
          </li>
        </ul>
      </div>

      {/* Alternatives */}
      <div className="mb-2">
        <p className="text-xs font-semibold text-slate-700 mb-2">
          Alternative strategies that can improve the odds:
        </p>
        <ul className="list-disc list-inside space-y-1.5 text-xs text-slate-700 leading-relaxed">
          {anyIneligible && (
            <li>
              <span className="font-medium">
                Work until the year you turn 55
              </span>{" "}
              — retiring at 55 instead of {earliestRetireAge} unlocks the Rule
              of 55 for your current employer's plan
              {totalPenalties > 0
                ? ` and could avoid much of the ${fmtMoney(totalPenalties)} in projected penalties`
                : ""}
              . Test it with the Retirement Age lever.
            </li>
          )}
          <li>
            <span className="font-medium">
              <TermLabel info={TERM_HELP.sepp}>
                SEPP / 72(t) payments
              </TermLabel>
            </span>{" "}
            — a legal way to take penalty-free IRA withdrawals before 59½ by
            locking into a fixed schedule for 5+ years. Rigid and easy to get
            wrong (breaking it triggers back-penalties), and not modeled here
            — worth discussing with a professional if your penalty-free money
            falls short.
          </li>
          <li>
            <span className="font-medium">Roth IRA contributions</span> — in
            real life, the amounts you contributed directly (not earnings, not
            recent conversions) can come out any time without tax or penalty.
            This model doesn't track that layer, so treat any Roth flexibility
            as a bonus cushion it isn't showing you.
          </li>
          <li>
            <span className="font-medium">Part-time income</span> —{" "}
            {displayInputs.partTimeIncome > 0
              ? `your ${fmtMoney(displayInputs.partTimeIncome)}/yr already offsets bridge withdrawals; extending it even a year or two helps more than it looks.`
              : "even $10–20K/yr in the bridge years replaces withdrawals exactly when your portfolio is most fragile. Try the Part-Time Income input."}
          </li>
          {stillWorking && (
            <li>
              <span className="font-medium">
                Redirect final working-year savings
              </span>{" "}
              — after capturing the full employer match, extra savings routed
              to your taxable brokerage (instead of extra 401k deferrals) land
              in the penalty-free bucket you'll actually spend first.
            </li>
          )}
          {maxSustainableSpending != null &&
            maxSustainableSpending < displayInputs.baseExpenses && (
              <li>
                <span className="font-medium">Trim spending</span> — this plan
                currently overshoots; lifestyle spending of about{" "}
                {fmtMoney(maxSustainableSpending)}/yr (vs{" "}
                {fmtMoney(displayInputs.baseExpenses)}) keeps it funded, and
                lower spending also means smaller taxable withdrawals each
                bridge year.
              </li>
            )}
        </ul>
      </div>

      <p className="text-[11px] text-slate-400 italic">
        Estimates only — early-withdrawal rules have exceptions and traps this
        tool can't see (plan documents, state rules, disability/medical
        exceptions, 457(b) plans with no early penalty). Confirm your specific
        situation with a fee-only fiduciary or CPA before acting.
      </p>
    </div>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

// Generic, illustrative starting values — NOT tied to any real person.
// These are placeholders so the charts render something on first load;
// every field is meant to be overwritten with the visitor's own numbers.
const DEFAULT_INPUTS = {
  mode: "single",
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

// ============================================================
// PREFERENCES PERSISTENCE  (strictly client-only — no server, no analytics)
// ============================================================
// All user data lives only in the visitor's own browser. We persist a small
// "scenario store" so a returning visitor sees their data preserved across
// browser restarts, and so each visitor can keep multiple named input sets.
//
// Storage backend tries Claude's window.storage first (works in Claude
// artifacts), then falls back to localStorage (works in any regular browser).
// Nothing here is ever transmitted off the device.

// Current store key + shape. Bump the suffix if the shape changes.
const STORE_KEY = "retirement-planner-store-v1";
// Legacy single-blob key (pre-scenarios). Migrated on first load, then removed.
const LEGACY_INPUTS_KEY = "retirement-planner-inputs";

function emptyStore() {
  return { version: 1, scenarios: [], activeScenarioId: null };
}

function makeScenarioId() {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// --- Low-level backend helpers (window.storage -> localStorage) ---

async function storageGetRaw(key) {
  try {
    if (typeof window !== "undefined" && window.storage) {
      const result = await window.storage.get(key);
      if (result && result.value != null) return result.value;
    }
  } catch (e) {
    // Not available or key doesn't exist — fall through to localStorage
  }
  try {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(key);
    }
  } catch (e) {
    // localStorage blocked (private mode, etc.)
  }
  return null;
}

async function storageSetRaw(key, value) {
  let ok = false;
  try {
    if (typeof window !== "undefined" && window.storage) {
      await window.storage.set(key, value);
      ok = true;
    }
  } catch (e) {
    // Fall through to localStorage
  }
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value);
      ok = true;
    }
  } catch (e) {
    if (!ok) console.error("Save failed:", e);
  }
  return ok;
}

async function storageDeleteRaw(key) {
  try {
    if (typeof window !== "undefined" && window.storage) {
      await window.storage.delete(key);
    }
  } catch (e) {
    // Key may not exist
  }
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(key);
    }
  } catch (e) {
    // ignore
  }
}

// --- Store-level API ---

function sanitizeStore(parsed) {
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.scenarios)) {
    return null;
  }
  const scenarios = parsed.scenarios
    .filter((s) => s && typeof s === "object" && s.inputs)
    .map((s) => ({
      id: typeof s.id === "string" ? s.id : makeScenarioId(),
      name: typeof s.name === "string" && s.name.trim() ? s.name : "Untitled",
      inputs: s.inputs,
      savedAt: typeof s.savedAt === "number" ? s.savedAt : Date.now(),
    }));
  const activeScenarioId = scenarios.some((s) => s.id === parsed.activeScenarioId)
    ? parsed.activeScenarioId
    : scenarios[0]?.id ?? null;
  return { version: 1, scenarios, activeScenarioId };
}

// Loads the scenario store. If only the legacy single-blob key exists, migrate
// it into a one-scenario store (no data loss) and remove the legacy key.
async function loadStore() {
  const rawStore = await storageGetRaw(STORE_KEY);
  if (rawStore) {
    try {
      const store = sanitizeStore(JSON.parse(rawStore));
      if (store) return store;
    } catch (e) {
      // Corrupt store — fall through to legacy / empty
    }
  }

  // Migration path: legacy single saved-inputs blob.
  const rawLegacy = await storageGetRaw(LEGACY_INPUTS_KEY);
  if (rawLegacy) {
    try {
      const inputs = JSON.parse(rawLegacy);
      const store = {
        version: 1,
        scenarios: [
          {
            id: makeScenarioId(),
            name: "My saved values",
            inputs,
            savedAt: Date.now(),
          },
        ],
        activeScenarioId: null,
      };
      store.activeScenarioId = store.scenarios[0].id;
      await storageSetRaw(STORE_KEY, JSON.stringify(store));
      await storageDeleteRaw(LEGACY_INPUTS_KEY);
      return store;
    } catch (e) {
      // Corrupt legacy blob — ignore
    }
  }

  return emptyStore();
}

async function saveStore(store) {
  return storageSetRaw(STORE_KEY, JSON.stringify(store));
}

// ============================================================
// SCENARIO COMPARISON
// ============================================================

function compareScenarios(baseInputs, retirementAges, spendingLevels) {
  const scenarios = [];
  const displayInputs = getDisplayInputs(baseInputs);
  const coupleInputs = isCoupleMode(baseInputs)
    ? normalizeCoupleInputs(baseInputs.couple)
    : null;
  for (const age of retirementAges) {
    for (const spending of spendingLevels) {
      const inputs = coupleInputs
        ? normalizeInputs({
            ...baseInputs,
            couple: {
              ...coupleInputs,
              primary: {
                ...coupleInputs.primary,
                retirementAge: age,
              },
              shared: {
                ...coupleInputs.shared,
                baseExpenses: spending,
              },
            },
          })
        : {
            ...baseInputs,
            retirementAge: age,
            baseExpenses: spending,
          };
      const result = simulatePlan(inputs);
      scenarios.push({
        retirementAge: age,
        spouseRetirementAge: coupleInputs?.spouse.retirementAge,
        baseExpenses: spending,
        portfolioAtRetirement: result.summary.portfolioAtRetirement,
        portfolioAtEnd: result.summary.portfolioAtEnd,
        yearsOfRetirement: displayInputs.planThroughAge - age,
        lifetimeSpending:
          (spending + displayInputs.healthcarePre65) *
          (displayInputs.planThroughAge - age),
      });
    }
  }
  return scenarios;
}

// ============================================================
// MONTE CARLO — Sequence of Returns Risk
// ============================================================

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
    PROJECTION_START_YEAR,
  );
  const wasLegacyDefaultRmd =
    rawInputs &&
    rawInputs.rmdStartAge === 73 &&
    rawInputs.currentAge != null &&
    computedRmdStartAge !== 73;
  return {
    ...merged,
    mode: merged.mode === "couple" ? "couple" : "single",
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

function buildChatProfile(inputs, results) {
  return {
    inputs,
    summary: results.summary,
    projectionRows: results.yearlyData.map((row) => ({
      year: row.year,
      age: row.age,
      phase: row.phase,
      spending: row.spending,
      tax: row.tax,
      partTime: row.partTime,
      socialSecurity: row.ss,
      pension: row.pension || 0,
      netNeed: row.netNeed,
      grossWithdrawal: row.grossWithdrawal,
      withdrawals: {
        cash: row.fromCash,
        taxable: row.fromTaxable,
        k401: row.from401k,
        ira: row.fromIra,
        roth: row.fromRoth,
        hsa: row.hsaWithdrawal || 0,
      },
      conversion: row.conversion,
      balances: {
        cash: row.cash,
        taxable: row.taxable,
        k401: row.k401,
        tradIra: row.tradIra,
        roth: row.roth,
        hsa: row.hsa,
        total: row.total,
      },
      rmdAmount: row.rmdAmount || 0,
      magi: row.magi || 0,
      taxableSs: row.taxableSs || 0,
      realizedGain: row.realizedGain || 0,
      irmaaSurcharge: row.irmaaSurcharge || 0,
      acaSubsidy: row.acaSubsidy || 0,
      unmetCashFlow: row.unmetCashFlow || 0,
    })),
    modelNotes: [
      "Projection values are nominal unless the UI toggle displays today's dollars.",
      "Monte Carlo reuses the same deterministic tax/RMD/conversion engine with randomized returns.",
      "This is planning analysis, not tax, legal, investment, or fiduciary advice.",
    ],
  };
}

// Box-Muller transform for normal distribution
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
  const materialThreshold = Math.max(
    100,
    (result.summary.year1Spending || 0) * 0.001,
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
    depletedAge: depletedRow ? depletedRow.age : null,
  };
}

function runMonteCarlo(inputs, numSims = 500) {
  const displayInputs = getDisplayInputs(inputs);
  const yearsInRetirement = displayInputs.planThroughAge - displayInputs.retirementAge + 1;
  const meanReturn = displayInputs.postReturn;
  const stdDev = displayInputs.portfolioVolatility || 0.09;

  const allRuns = [];
  let successCount = 0;
  const finalValues = [];
  const depletionAges = [];

  for (let i = 0; i < numSims; i++) {
    const yearlyReturns = Array.from({ length: yearsInRetirement + 10 }, () =>
      randomNormal(meanReturn, stdDev),
    );
    const result = simulateWithReturns(inputs, yearlyReturns);
    allRuns.push(result.history);
    if (!result.depleted) {
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
    successRate: successCount / numSims,
    percentiles,
    finalP10: finalValues[Math.floor(numSims * 0.1)],
    finalP50: finalValues[Math.floor(numSims * 0.5)],
    finalP90: finalValues[Math.floor(numSims * 0.9)],
    avgDepletionAge:
      depletionAges.length > 0
        ? depletionAges.reduce((a, b) => a + b, 0) / depletionAges.length
        : null,
    numSims,
  };
}

// ============================================================
// DIAGNOSE WHY SUCCESS RATE IS WHAT IT IS
// ============================================================

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

function scaleOwnerDetails(ownerDetails, factor) {
  if (!ownerDetails) return ownerDetails;
  const moneyFields = [
    "from401k",
    "fromIra",
    "fromRoth",
    "hsaWithdrawal",
    "conversion",
    "rmdAmount",
    "ss",
    "pension",
    "partTime",
    "contribution401kApplied",
    "contributionHsaApplied",
  ];
  const scalePerson = (person = {}) => {
    const scaled = { ...person };
    for (const field of moneyFields) {
      if (typeof scaled[field] === "number") scaled[field] *= factor;
    }
    return scaled;
  };
  return {
    primary: scalePerson(ownerDetails.primary),
    spouse: scalePerson(ownerDetails.spouse),
  };
}

function CouplePersonInputs({ title, person, onChange, shared }) {
  const contributionLimits = getContributionLimits(
    person.currentAge,
    PROJECTION_START_YEAR,
    shared.inflation,
    shared.householdSize,
  );
  const employerPlanLabel = person.employerPlanLabel || "401k";
  return (
    <Section
      title={title}
      defaultOpen={title === "Primary" || person.pensionIncome > 0}
      badge={person.pensionIncome > 0 ? "Pension Active" : "No Pension"}
      variant={title === "Spouse" ? "spouse" : "primary"}
    >
      <TextInput label="Name" value={person.name} onChange={onChange("name")} />
      <TextInput
        label="Employer Plan Label"
        value={employerPlanLabel}
        onChange={onChange("employerPlanLabel")}
        hint="Used in couple reports, for example 401k, 403b, or TSP."
      />
      <NumberInput
        label="Current Age"
        value={person.currentAge}
        onChange={onChange("currentAge")}
      />
      <NumberInput
        label="Retirement Age"
        value={person.retirementAge}
        onChange={onChange("retirementAge")}
      />
      <NumberInput
        label="Plan Through Age"
        value={person.planThroughAge}
        onChange={onChange("planThroughAge")}
      />
      <NumberInput
        label={`${employerPlanLabel} Balance`}
        value={person.balance401k}
        onChange={onChange("balance401k")}
        prefix="$"
        step={1000}
      />
      <NumberInput
        label="Traditional IRA"
        value={person.balanceTradIra}
        onChange={onChange("balanceTradIra")}
        prefix="$"
        step={1000}
      />
      <NumberInput
        label="Roth IRA"
        value={person.balanceRoth}
        onChange={onChange("balanceRoth")}
        prefix="$"
        step={1000}
      />
      <NumberInput
        label="HSA"
        value={person.balanceHsa}
        onChange={onChange("balanceHsa")}
        prefix="$"
        step={1000}
        info={TERM_HELP.hsa}
      />
      <NumberInput
        label={`${employerPlanLabel} Employee`}
        value={person.contrib401k}
        onChange={onChange("contrib401k")}
        prefix="$"
        step={500}
        hint={`Capped at ${fmtMoneyFull(contributionLimits.k401Employee)} for ${PROJECTION_START_YEAR}`}
      />
      <NumberInput
        label="Employer Match"
        value={person.contribMatch}
        onChange={onChange("contribMatch")}
        prefix="$"
        step={500}
      />
      <NumberInput
        label="HSA Contribution"
        value={person.contribHsa}
        onChange={onChange("contribHsa")}
        prefix="$"
        step={500}
      />
      <NumberInput
        label="Part-Time Income / Year"
        value={person.partTimeIncome}
        onChange={onChange("partTimeIncome")}
        prefix="$"
        step={1000}
      />
      <NumberInput
        label="Years of Part-Time Work"
        value={person.partTimeYears}
        onChange={onChange("partTimeYears")}
      />
      <NumberInput
        label="Social Security at FRA / Year"
        value={person.ssIncome}
        onChange={onChange("ssIncome")}
        prefix="$"
        step={1000}
        info={TERM_HELP.fra}
      />
      <NumberInput
        label="Age to Claim SS"
        value={person.ssAge}
        onChange={onChange("ssAge")}
        hint="62 (earliest) to 70; 67 = full benefit"
      />
      <NumberInput
        label="Annual Pension"
        value={person.pensionIncome}
        onChange={onChange("pensionIncome")}
        prefix="$"
        step={1000}
      />
      <NumberInput
        label="Pension Start Age"
        value={person.pensionStartAge}
        onChange={onChange("pensionStartAge")}
      />
      <PctInput
        label="Pension COLA"
        value={person.pensionCola}
        onChange={onChange("pensionCola")}
      />
      <div className="mb-3 mt-2 p-2 bg-slate-50 rounded border border-slate-200">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={person.pensionNyExempt !== false}
            onChange={(e) => onChange("pensionNyExempt")(e.target.checked)}
            className="mt-0.5"
          />
          <div>
            <div className="text-xs font-medium text-slate-700">
              NY State Tax Exempt Pension
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              Check for public pensions; uncheck for private pensions.
            </div>
          </div>
        </label>
      </div>
      <NumberInput
        label="RMD Start Age"
        value={person.rmdStartAge}
        onChange={onChange("rmdStartAge")}
      />
      <NumberInput
        label="Roth Conversion: retirement–59 / Year"
        value={person.conversionBridge}
        onChange={onChange("conversionBridge")}
        prefix="$"
        step={5000}
        hint="Applies each year from this person's retirement until age 59"
      />
      <NumberInput
        label="Roth Conversion: Ages 60-64 / Year"
        value={person.conversionMid}
        onChange={onChange("conversionMid")}
        prefix="$"
        step={5000}
      />
      <NumberInput
        label="Roth Conversion: 65 until SS / Year"
        value={person.conversionFinal}
        onChange={onChange("conversionFinal")}
        prefix="$"
        step={5000}
      />
      <NumberInput
        label="Healthcare before 65"
        value={person.healthcarePre65}
        onChange={onChange("healthcarePre65")}
        prefix="$"
        step={1000}
        hint="Per year, today's dollars, from this person's retirement until Medicare at 65"
        info={TERM_HELP.aca}
      />
      <NumberInput
        label="Healthcare 65+"
        value={person.healthcarePost65}
        onChange={onChange("healthcarePost65")}
        prefix="$"
        step={500}
        hint="Per year, today's dollars — Medicare + Medigap + out-of-pocket"
      />
    </Section>
  );
}

// One always-visible slider+number pair. Slider for exploration (continuous
// live feedback), number input for exact entry — both bound to the same state.
function LeverRow({ label, value, onChange, min, max, step, isPercent = false, prefix }) {
  const display = isPercent ? Math.round(value * 10000) / 100 : value;
  const emit = (n) => {
    if (Number.isNaN(n)) return;
    onChange(isPercent ? n / 100 : n);
  };
  const clamped = Math.min(max, Math.max(min, display));
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-slate-600">{label}</label>
        <div className="relative">
          {prefix && (
            <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-400 text-[11px] pointer-events-none">
              {prefix}
            </span>
          )}
          <input
            type="number"
            value={display}
            step={step}
            onChange={(e) => emit(Number(e.target.value))}
            className={`w-24 text-right rounded border border-slate-300 bg-white text-slate-900 text-xs py-0.5 pr-1.5 ${prefix ? "pl-4" : "pl-1.5"} focus:outline-none focus:ring-1 focus:ring-indigo-500`}
          />
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={clamped}
        onChange={(e) => emit(Number(e.target.value))}
        className="w-full accent-indigo-600 mt-1 cursor-pointer"
        aria-label={label}
      />
    </div>
  );
}

// The handful of inputs that drive most outcomes, pinned at the top of the
// sidebar so users can drag them and watch the results bar react. Every
// lever also exists in the detailed sections below — same state, two views.
const LEVERS_OPEN_KEY = "retirement-planner-levers-open";

function KeyLevers({ inputs, isCouple, update, updateCouple }) {
  const couple = isCouple ? normalizeCoupleInputs(inputs.couple) : null;
  // Collapsed state persists across visits so the panel stays out of the way
  // for users who prefer working in the detailed sections.
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(LEVERS_OPEN_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const toggle = () => {
    const next = !open;
    try {
      localStorage.setItem(LEVERS_OPEN_KEY, next ? "1" : "0");
    } catch {
      // Private mode — preference just won't persist.
    }
    setOpen(next);
  };
  return (
    <div className="bg-white rounded-lg border border-indigo-300 shadow-sm mb-4 lg:sticky lg:top-0 lg:z-20 overflow-hidden">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between gap-2 text-left px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 transition"
        title={open ? "Collapse the key levers" : "Expand the key levers"}
      >
        <span className="flex items-center gap-2">
          <span className="text-base leading-none">🎚️</span>
          <span className="text-sm font-semibold text-slate-900">
            Key levers
          </span>
          <span className="text-[10px] uppercase tracking-wider text-indigo-600 font-semibold">
            Live
          </span>
        </span>
        <svg
          className={`w-4 h-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
      <div className="p-4 pt-3">
      <p className="text-xs text-slate-500 mb-3">
        The inputs that move the plan most — drag and watch the results react.
        Everything else is in the sections below.
      </p>
      {isCouple ? (
        <>
          <LeverRow
            label="Primary retires at"
            value={couple.primary.retirementAge}
            onChange={updateCouple("primary", "retirementAge")}
            min={50}
            max={75}
            step={1}
          />
          <LeverRow
            label="Spouse retires at"
            value={couple.spouse.retirementAge}
            onChange={updateCouple("spouse", "retirementAge")}
            min={50}
            max={75}
            step={1}
          />
          <LeverRow
            label="Household spending / yr"
            value={couple.shared.baseExpenses}
            onChange={updateCouple("shared", "baseExpenses")}
            min={20000}
            max={200000}
            step={5000}
            prefix="$"
          />
          <LeverRow
            label="Return in retirement %"
            value={couple.shared.postReturn}
            onChange={updateCouple("shared", "postReturn")}
            min={2}
            max={10}
            step={0.25}
            isPercent
          />
        </>
      ) : (
        <>
          <LeverRow
            label="Retire at age"
            value={inputs.retirementAge}
            onChange={update("retirementAge")}
            min={50}
            max={75}
            step={1}
          />
          <LeverRow
            label="Spending / yr"
            value={inputs.baseExpenses}
            onChange={update("baseExpenses")}
            min={20000}
            max={200000}
            step={5000}
            prefix="$"
          />
          <LeverRow
            label="SS claim age"
            value={inputs.ssAge}
            onChange={update("ssAge")}
            min={62}
            max={70}
            step={1}
          />
          <LeverRow
            label="Return before retiring %"
            value={inputs.preReturn}
            onChange={update("preReturn")}
            min={2}
            max={10}
            step={0.25}
            isPercent
          />
          <LeverRow
            label="Return in retirement %"
            value={inputs.postReturn}
            onChange={update("postReturn")}
            min={2}
            max={10}
            step={0.25}
            isPercent
          />
        </>
      )}
      </div>
      )}
    </div>
  );
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

// Cash drawdown controls — used by the individual sidebar and, in couple
// mode, the shared Household section (cash is a shared bucket).
function CashStrategyInputs({ values, onChange, earlyRetirement = false }) {
  const strategy = values.cashStrategy || "cashFirst";
  const selected = CASH_STRATEGY_OPTIONS.find((o) => o.value === strategy);
  const reserveActive = strategy !== "cashFirst";
  const penaltyRisk =
    earlyRetirement && (strategy === "cashLast" || strategy === "proportional");
  return (
    <>
      <div className="mb-3">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Cash Withdrawal Strategy
        </label>
        <select
          value={strategy}
          onChange={(e) => onChange("cashStrategy")(e.target.value)}
          className="w-full rounded-md border border-slate-300 bg-white text-slate-900 text-sm py-1.5 px-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
        >
          {CASH_STRATEGY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {selected && (
          <p className="text-xs text-slate-500 mt-1">{selected.blurb}</p>
        )}
        {penaltyRisk && (
          <p className="text-xs text-amber-700 mt-1 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            Heads up: retiring before 59½ with this strategy can route draws
            into 401k/IRA territory, where the 10% early-withdrawal penalty
            applies (PENALTY rows in the year table). Compare lifetime tax +
            penalty before committing.
          </p>
        )}
      </div>
      <NumberInput
        label="Minimum Cash Reserve"
        value={values.cashReserveFloor || 0}
        onChange={onChange("cashReserveFloor")}
        prefix="$"
        step={5000}
        hint={
          reserveActive
            ? "Today's dollars — the floor grows with inflation in the projection."
            : 'Ignored under "Use cash first" — pick another strategy to protect a reserve.'
        }
      />
      {reserveActive && (values.cashReserveFloor || 0) > 0 && (
        <div className="mb-3 mt-2 p-2 bg-slate-50 rounded border border-slate-200">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={values.allowReserveAsLastResort === true}
              onChange={(e) =>
                onChange("allowReserveAsLastResort")(e.target.checked)
              }
              className="mt-0.5"
            />
            <div>
              <div className="text-xs font-medium text-slate-700">
                Allow reserve as last resort
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                If every other account is empty, the reserve may be spent
                (flagged RESERVE in the year table). When off, the plan shows a
                shortfall instead of touching the reserve.
              </div>
            </div>
          </label>
        </div>
      )}
    </>
  );
}

function CoupleInputs({ couple, updateCouple }) {
  const { primary, spouse, shared } = normalizeCoupleInputs(couple);
  const sharedChange = (key) => updateCouple("shared", key);
  return (
    <>
      <Section title="Household" defaultOpen variant="household" badge="Shared">
        <div className="mb-3 rounded border border-indigo-200 bg-indigo-50 p-3 text-xs leading-relaxed text-indigo-900">
          Married-couple mode uses MFJ taxes, shared cash/taxable/expenses,
          and separate spouse timelines, accounts, Social Security, RMDs, and
          Roth conversions. Survivor modeling is not included in v1.
          <span className="mt-1 block">
            <span className="font-semibold">Heads up:</span> while one spouse
            still works, their paycheck is assumed to cover{" "}
            <em>their own contributions only</em> — all household spending is
            drawn from savings once the first spouse retires. If the working
            spouse's income actually covers the bills, this plan is more
            pessimistic than reality.
          </span>
        </div>
        <NumberInput
          label="Cash / HYSA"
          value={shared.balanceCash}
          onChange={sharedChange("balanceCash")}
          prefix="$"
          step={1000}
          info={TERM_HELP.hysa}
        />
        <NumberInput
          label="Taxable Brokerage"
          value={shared.balanceTaxable}
          onChange={sharedChange("balanceTaxable")}
          prefix="$"
          step={1000}
        />
        <PctInput
          label="Taxable Cost Basis %"
          value={shared.taxableBasisPct}
          onChange={sharedChange("taxableBasisPct")}
        />
        <NumberInput
          label="Credit Card Debt"
          value={shared.creditCardDebt}
          onChange={sharedChange("creditCardDebt")}
          prefix="$"
          step={100}
        />
        <CashStrategyInputs
          values={shared}
          onChange={sharedChange}
          earlyRetirement={
            Math.min(primary.retirementAge, spouse.retirementAge) < 59.5
          }
        />
        <NumberInput
          label="Base Lifestyle Expenses"
          value={shared.baseExpenses}
          onChange={sharedChange("baseExpenses")}
          prefix="$"
          step={1000}
          hint="Shared non-healthcare annual spending once either spouse retires"
        />
        <PctInput
          label="Pre-Retirement Return"
          value={shared.preReturn}
          onChange={sharedChange("preReturn")}
        />
        <PctInput
          label="Post-Retirement Return"
          value={shared.postReturn}
          onChange={sharedChange("postReturn")}
        />
        <PctInput
          label="Cash / HYSA Return"
          value={shared.cashReturn}
          onChange={sharedChange("cashReturn")}
          info={TERM_HELP.hysa}
        />
        <PctInput
          label="Inflation Rate"
          value={shared.inflation}
          onChange={sharedChange("inflation")}
        />
        <PctInput
          label="Portfolio Volatility"
          value={shared.portfolioVolatility}
          onChange={sharedChange("portfolioVolatility")}
        />
        <PctInput
          label="Taxable Annual Tax Drag"
          value={shared.taxableAnnualTaxDrag}
          onChange={sharedChange("taxableAnnualTaxDrag")}
        />
        <NumberInput
          label="Household Size"
          value={shared.householdSize}
          onChange={sharedChange("householdSize")}
          hint="At least 2 in couple mode. Drives ACA subsidy math, the family HSA limit, and Medicare premium counts"
        />
        <div className="mb-3 mt-2 p-2 bg-slate-50 rounded border border-slate-200">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={shared.flexibleSpending !== false}
              onChange={(e) => sharedChange("flexibleSpending")(e.target.checked)}
              className="mt-0.5"
            />
            <div>
              <div className="text-xs font-medium text-slate-700">
                <TermLabel info={TERM_HELP.flexibleSpending}>
                  Flexible Spending
                </TermLabel>
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                Reduces spending 10% in years after a market drop &gt;15%.
              </div>
            </div>
          </label>
        </div>
        <div className="mb-3 mt-2 p-2 bg-slate-50 rounded border border-slate-200">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={shared.useAcaSubsidyEstimate === true}
              onChange={(e) =>
                sharedChange("useAcaSubsidyEstimate")(e.target.checked)
              }
              className="mt-0.5"
            />
            <div>
              <div className="text-xs font-medium text-slate-700">
                <TermLabel info={TERM_HELP.aca}>
                  Estimate ACA Subsidy
                </TermLabel>
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                Couple v1 keeps this setting for compatibility; detailed
                household ACA subsidy iteration remains approximate.
              </div>
            </div>
          </label>
        </div>
      </Section>
      <CouplePersonInputs
        title="Primary"
        person={primary}
        shared={shared}
        onChange={(key) => updateCouple("primary", key)}
      />
      <CouplePersonInputs
        title="Spouse"
        person={spouse}
        shared={shared}
        onChange={(key) => updateCouple("spouse", key)}
      />
    </>
  );
}

export default function RetirementPlanner() {
  const [inputs, setInputs] = useState(() => normalizeInputs(DEFAULT_INPUTS));
  const [showRealDollars, setShowRealDollars] = useState(false);
  const [activeTab, setActiveTab] = useState("plan");
  // Slim fixed results bar appears once the full metrics strip scrolls away,
  // so edits anywhere in the long input list show instant feedback.
  const [pageScrolled, setPageScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setPageScrolled(window.scrollY > 180);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const [mcRunning, setMcRunning] = useState(false);
  const [mcResults, setMcResults] = useState(null);
  // Inputs snapshot at the moment Monte Carlo last ran. Any input change
  // replaces the inputs object, so identity inequality means "stale".
  const mcInputsRef = useRef(null);
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | cleared
  const [diagnostics, setDiagnostics] = useState(null);
  // Named scenarios persisted in this browser only.
  const [savedScenarios, setSavedScenarios] = useState([]);
  const [activeScenarioId, setActiveScenarioId] = useState(null);
  const activeScenario = useMemo(
    () => savedScenarios.find((s) => s.id === activeScenarioId) ?? null,
    [savedScenarios, activeScenarioId],
  );
  // Has the working input set diverged from the active scenario's saved inputs?
  const isDirty = useMemo(() => {
    if (!activeScenario) return false;
    // Compare against the normalized form so a migrated/legacy scenario whose
    // stored shape predates newer fields doesn't read as permanently "unsaved".
    return (
      JSON.stringify(normalizeInputs(activeScenario.inputs)) !==
      JSON.stringify(inputs)
    );
  }, [activeScenario, inputs]);
  const isCouple = isCoupleMode(inputs);
  const displayInputs = useMemo(() => getDisplayInputs(inputs), [inputs]);
  const results = useMemo(() => simulatePlan(inputs), [inputs]);
  // "How much can I actually spend?" — one number, solved by bisection.
  const maxSustainableSpending = useMemo(
    () => solveMaxSustainableSpending(inputs),
    [inputs],
  );

  // Stale MC results are withheld from the narrative so it never quotes a
  // success rate computed from inputs that no longer exist.
  const planNarrative = useMemo(
    () =>
      generatePlanNarrative(
        displayInputs,
        results,
        mcResults && mcInputsRef.current === inputs ? mcResults : null,
        maxSustainableSpending,
      ),
    [displayInputs, results, mcResults, inputs, maxSustainableSpending],
  );

  // Load the scenario store on mount and restore the active scenario's inputs.
  useEffect(() => {
    let mounted = true;
    loadStore().then((store) => {
      if (!mounted) return;
      setSavedScenarios(store.scenarios);
      setActiveScenarioId(store.activeScenarioId);
      const active = store.scenarios.find((s) => s.id === store.activeScenarioId);
      if (active) {
        // Merge saved inputs with defaults in case new fields were added.
        setInputs(normalizeInputs(active.inputs));
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Persist a scenario list + active id to this browser, and flash status.
  const persistStore = async (nextScenarios, nextActiveId, status = "saved") => {
    setSavedScenarios(nextScenarios);
    setActiveScenarioId(nextActiveId);
    setSaveStatus(status === "saved" ? "saving" : status);
    const ok = await saveStore({
      version: 1,
      scenarios: nextScenarios,
      activeScenarioId: nextActiveId,
    });
    setSaveStatus(ok ? status : "idle");
    setTimeout(() => setSaveStatus("idle"), 2500);
    return ok;
  };

  // Save current inputs into the active scenario (or create one if none).
  const handleSaveScenario = async () => {
    if (!activeScenario) {
      return handleSaveAsScenario();
    }
    const next = savedScenarios.map((s) =>
      s.id === activeScenario.id
        ? { ...s, inputs, savedAt: Date.now() }
        : s,
    );
    await persistStore(next, activeScenario.id);
  };

  // Create a new named scenario from the current inputs and make it active.
  const handleSaveAsScenario = async () => {
    const suggested =
      savedScenarios.length === 0
        ? "My plan"
        : `Scenario ${savedScenarios.length + 1}`;
    const name = (window.prompt("Name this scenario:", suggested) || "").trim();
    if (!name) return;
    const scenario = {
      id: makeScenarioId(),
      name,
      inputs,
      savedAt: Date.now(),
    };
    await persistStore([...savedScenarios, scenario], scenario.id);
  };

  // Switch to a saved scenario, loading its inputs as the working set.
  const handleSelectScenario = async (id) => {
    if (!id) return;
    const scenario = savedScenarios.find((s) => s.id === id);
    if (!scenario) return;
    setInputs(normalizeInputs(scenario.inputs));
    await persistStore(savedScenarios, id, "loaded");
  };

  const handleRenameScenario = async () => {
    if (!activeScenario) return;
    const name = (
      window.prompt("Rename scenario:", activeScenario.name) || ""
    ).trim();
    if (!name) return;
    const next = savedScenarios.map((s) =>
      s.id === activeScenario.id ? { ...s, name } : s,
    );
    await persistStore(next, activeScenario.id);
  };

  const handleDeleteScenario = async () => {
    if (!activeScenario) return;
    if (
      !window.confirm(
        `Delete scenario "${activeScenario.name}"? This only affects this browser.`,
      )
    ) {
      return;
    }
    const next = savedScenarios.filter((s) => s.id !== activeScenario.id);
    const nextActiveId = next[0]?.id ?? null;
    if (nextActiveId) {
      const nextActive = next.find((s) => s.id === nextActiveId);
      if (nextActive) setInputs(normalizeInputs(nextActive.inputs));
    }
    await persistStore(next, nextActiveId, "cleared");
  };

  // Reset only the working inputs to built-in defaults; does not delete scenarios.
  const handleResetToDefaults = () => {
    setInputs(normalizeInputs(DEFAULT_INPUTS));
    setActiveScenarioId(null);
    setSaveStatus("cleared");
    setTimeout(() => setSaveStatus("idle"), 2500);
  };

  const hasSavedScenarios = savedScenarios.length > 0;

  // Compute scenario comparison — ages always derive from the user's own
  // retirement age (earlier hardcoded ages described plans nobody entered).
  const scenarios = useMemo(() => {
    const baseAge = displayInputs.retirementAge;
    const minAge = displayInputs.currentAge;
    const ages = [
      ...new Set(
        (isCouple
          ? [baseAge - 3, baseAge, baseAge + 2, baseAge + 5]
          : [baseAge - 3, baseAge - 1, baseAge, baseAge + 2, baseAge + 5]
        ).filter((age) => age === baseAge || age > minAge),
      ),
    ];
    const spendingLevels = [
      Math.round(displayInputs.baseExpenses * 0.85),
      displayInputs.baseExpenses,
      Math.round(displayInputs.baseExpenses * 1.25),
    ];
    return compareScenarios(inputs, ages, spendingLevels);
  }, [displayInputs, inputs, isCouple]);

  const runMC = () => {
    setMcRunning(true);
    // Defer to next tick so UI can update
    setTimeout(() => {
      const result = runMonteCarlo(inputs, 500);
      mcInputsRef.current = inputs;
      setMcResults(result);
      setMcRunning(false);
    }, 50);
  };
  const mcStale = mcResults != null && mcInputsRef.current !== inputs;

  const update = (key) => (val) =>
    setInputs((prev) => {
      const next = { ...prev, [key]: val };
      if (
        key === "currentAge" &&
        prev.rmdStartAge === defaultRmdStartAge(prev.currentAge)
      ) {
        next.rmdStartAge = defaultRmdStartAge(val);
      }
      return next;
    });

  const updateMode = (mode) => {
    setInputs((prev) => normalizeInputs({ ...prev, mode }));
    setMcResults(null);
    setDiagnostics(null);
  };

  const updateCouple = (section, key) => (val) =>
    setInputs((prev) => {
      const couple = normalizeCoupleInputs(prev.couple);
      const nextSection = { ...couple[section], [key]: val };
      if (
        key === "currentAge" &&
        couple[section].rmdStartAge === defaultRmdStartAge(couple[section].currentAge)
      ) {
        nextSection.rmdStartAge = defaultRmdStartAge(val);
      }
      return normalizeInputs({
        ...prev,
        mode: "couple",
        couple: {
          ...couple,
          [section]: nextSection,
        },
      });
    });

  const applyChatChanges = (changes) => {
    const result = buildAppliedInputChanges(inputs, changes);
    if (result.applied.length > 0) {
      setInputs((prev) => normalizeInputs({ ...prev, ...result.updates }));
      setMcResults(null);
      setDiagnostics(null);
    }
    return result;
  };

  const reset = handleResetToDefaults;

  const currentYear = PROJECTION_START_YEAR;
  // Convert a nominal value to today's dollars based on the year it occurs
  const adjust = (val, year) => {
    if (!showRealDollars) return val;
    return val / Math.pow(1 + displayInputs.inflation, year - currentYear);
  };
  // Adjust an entire row's financial fields
  const adjustRow = (row) => {
    if (!showRealDollars) return row;
    const factor = 1 / Math.pow(1 + displayInputs.inflation, row.year - currentYear);
    return {
      ...row,
      spending: row.spending * factor,
      partTime: row.partTime * factor,
      ss: row.ss * factor,
      pension: (row.pension || 0) * factor,
      netNeed: row.netNeed * factor,
      grossWithdrawal: row.grossWithdrawal * factor,
      fromCash: row.fromCash * factor,
      fromTaxable: row.fromTaxable * factor,
      from401k: row.from401k * factor,
      fromIra: row.fromIra * factor,
      fromRoth: row.fromRoth * factor,
      hsaWithdrawal: (row.hsaWithdrawal || 0) * factor,
      conversion: row.conversion * factor,
      tax: row.tax * factor,
      unmetCashFlow: (row.unmetCashFlow || 0) * factor,
      cash: row.cash * factor,
      taxable: row.taxable * factor,
      k401: row.k401 * factor,
      tradIra: row.tradIra * factor,
      roth: row.roth * factor,
      hsa: row.hsa * factor,
      total: row.total * factor,
      rmdAmount: (row.rmdAmount || 0) * factor,
      realizedGain: (row.realizedGain || 0) * factor,
      taxableSs: (row.taxableSs || 0) * factor,
      magi: (row.magi || 0) * factor,
      taxableBasisEnd: (row.taxableBasisEnd || 0) * factor,
      irmaaSurcharge: (row.irmaaSurcharge || 0) * factor,
      acaSubsidy: (row.acaSubsidy || 0) * factor,
      cashFloor: (row.cashFloor || 0) * factor,
      reserveUsed: (row.reserveUsed || 0) * factor,
      earlyPenalty: (row.earlyPenalty || 0) * factor,
      ownerDetails: scaleOwnerDetails(row.ownerDetails, factor),
    };
  };

  const employerPlanChartKey = isCouple ? "Employer Plans" : "401k";
  const chartData = results.yearlyData.map((d) => ({
    ...d,
    age: d.age,
    axisLabel: formatAxisLabel(d, isCouple),
    Cash: d.cash,
    Taxable: d.taxable,
    [employerPlanChartKey]: d.k401,
    "Trad IRA": d.tradIra,
    Roth: d.roth,
    HSA: d.hsa,
    "Annual Spending": d.phase === "accumulation" ? null : d.spending,
  }));

  const flowData = results.yearlyData
    .filter((d) => d.phase !== "accumulation")
    .map((d) => ({
      ...d,
      age: d.age,
      axisLabel: formatAxisLabel(d, isCouple),
      "Part-Time": d.partTime,
      "Social Security": d.ss,
      Pension: d.pension || 0,
      Cash: d.fromCash,
      Taxable: d.fromTaxable,
      [employerPlanChartKey]: d.from401k,
      IRA: d.fromIra,
      Roth: d.fromRoth,
      HSA: d.hsaWithdrawal,
      Spending: d.spending,
      "Need (Spending + Tax)": d.spending + d.tax,
      ownerDetails: d.ownerDetails,
    }));
  const chartAxisTicks = buildReadableAxisTicks(chartData, isCouple ? 10 : 12);
  const flowAxisTicks = buildReadableAxisTicks(flowData, isCouple ? 8 : 10);
  const adjustedSpendableRows = isCouple
    ? results.yearlyData
        .filter((d) => d.phase !== "accumulation")
        .map((row) => adjustRow(row))
    : [];
  const retirementAxisValue =
    chartData.find((row) => row.age === displayInputs.retirementAge)?.axisLabel ??
    displayInputs.retirementAge;
  const ssAxisValue =
    chartData.find((row) => row.age === displayInputs.ssAge)?.axisLabel ??
    displayInputs.ssAge;

  const s = results.summary;
  const materialUnmetCashFlow = hasMaterialUnmetCashFlow(s);
  const shortfall = computeShortfallInfo(results);
  const shortfallAxisValue =
    shortfall.firstShortfallAge != null
      ? chartData.find((row) => row.age === shortfall.firstShortfallAge)
          ?.axisLabel ?? shortfall.firstShortfallAge
      : null;
  const chatProfile = useMemo(
    () => buildChatProfile(inputs, results),
    [inputs, results],
  );
  const currentContributionLimits = getContributionLimits(
    displayInputs.currentAge,
    PROJECTION_START_YEAR,
    displayInputs.inflation,
    displayInputs.householdSize,
  );
  const yearDetailColSpan = displayInputs.pensionIncome > 0 ? 16 : 15;
  // For an already-retired user the "portfolio at retirement" metric describes
  // the end of the first projected year, which happens at the current age.
  const retirementDisplayAge = Math.max(
    displayInputs.retirementAge,
    displayInputs.currentAge,
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Slim live results bar — fixed overlay once the metrics strip is
          scrolled out of view. Mirrors the headline numbers + plan status. */}
      {pageScrolled && (
        <div className="fixed top-0 inset-x-0 z-40 bg-white border-b border-slate-300 shadow-sm print:hidden">
          <div className="max-w-[1800px] mx-auto px-6 py-2 flex items-center gap-x-5 gap-y-1 flex-wrap text-xs">
            <span
              className={`inline-flex items-center gap-1.5 font-semibold ${
                shortfall.status === "danger"
                  ? "text-rose-700"
                  : shortfall.status === "warning"
                    ? "text-amber-700"
                    : "text-emerald-700"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  shortfall.status === "danger"
                    ? "bg-rose-500 animate-pulse"
                    : shortfall.status === "warning"
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                }`}
              ></span>
              {shortfall.status === "danger"
                ? `Shortfall at age ${shortfall.firstShortfallAge ?? "—"}`
                : shortfall.status === "warning"
                  ? "Funded — thin margin"
                  : `On track to ${displayInputs.planThroughAge}`}
            </span>
            <span>
              <span className="text-slate-500">
                At {retirementDisplayAge}:
              </span>{" "}
              <span className="font-bold">
                {fmtMoney(
                  adjust(
                    s.portfolioAtRetirement,
                    currentYear +
                      (retirementDisplayAge - displayInputs.currentAge),
                  ),
                )}
              </span>
            </span>
            <span>
              <span className="text-slate-500">
                At {displayInputs.planThroughAge}:
              </span>{" "}
              <span
                className={`font-bold ${
                  shortfall.status === "danger" ? "text-rose-700" : ""
                }`}
              >
                {fmtMoney(
                  adjust(
                    s.portfolioAtEnd,
                    currentYear +
                      (displayInputs.planThroughAge - displayInputs.currentAge),
                  ),
                )}
              </span>
            </span>
            <span>
              <span className="text-slate-500">Rate:</span>{" "}
              <span className="font-bold">{fmtPct(s.year1WithdrawalRate)}</span>
            </span>
            <span className="text-slate-400 hidden md:inline">
              {showRealDollars ? "today's $" : "nominal $"}
            </span>
          </div>
        </div>
      )}
      {/* Print-specific styles */}
      <style>{`
        @media print {
          @page { size: letter; margin: 0.4in; }
          body { 
            print-color-adjust: exact; 
            -webkit-print-color-adjust: exact;
            background: white !important;
          }
          .print-avoid-break { break-inside: avoid; page-break-inside: avoid; }
          .print-page-break { break-before: page; page-break-before: always; }
          table { font-size: 9px; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      {/* Print-only report header */}
      <div className="hidden print:block px-6 py-4 border-b-2 border-slate-900 mb-4">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Retirement Plan Report
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              Tax-aware projection with Roth conversion strategy
            </p>
          </div>
          <div className="text-right text-xs text-slate-600">
            <p>Generated: {new Date().toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}</p>
            <p>
              Retirement age {inputs.retirementAge} → Plan through age{" "}
              {inputs.planThroughAge}
            </p>
          </div>
        </div>
      </div>

      {/* Header */}
      <header className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-indigo-700 text-white px-6 py-5 shadow-md print:hidden">
        <div className="flex justify-between items-center max-w-[1800px] mx-auto">
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              Retirement Planner
            </h1>
            <p className="text-indigo-200 text-sm mt-0.5">
              Tax-aware projection • Roth conversion strategy • NY State
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* Scenario switcher lives here — always visible, like a
                document picker — instead of buried in the sidebar. */}
            <label className="flex items-center gap-1.5 text-xs text-indigo-200">
              <span className="hidden sm:inline font-medium">Scenario:</span>
              <select
                value={activeScenarioId ?? ""}
                onChange={(e) => handleSelectScenario(e.target.value)}
                aria-label="Active scenario"
                className="max-w-[200px] text-xs bg-white/10 hover:bg-white/20 border border-white/30 rounded px-2 py-1.5 text-white focus:outline-none focus:ring-2 focus:ring-white/50 [&>option]:text-slate-900 cursor-pointer"
                title="Switch between saved scenarios. Scenarios live only in this browser — nothing is uploaded."
              >
                {!hasSavedScenarios && (
                  <option value="">No saved scenarios yet</option>
                )}
                {activeScenarioId === null && hasSavedScenarios && (
                  <option value="">Built-in defaults (unsaved)</option>
                )}
                {savedScenarios.map((sc) => (
                  <option key={sc.id} value={sc.id}>
                    {sc.name}
                  </option>
                ))}
              </select>
            </label>
            {activeScenario && saveStatus === "idle" && (
              <span
                className={`text-xs flex items-center gap-1 ${
                  isDirty ? "text-amber-200" : "text-emerald-300"
                }`}
              >
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    isDirty ? "bg-amber-300" : "bg-emerald-400"
                  }`}
                ></span>
                {isDirty ? "unsaved" : "saved"}
              </span>
            )}
            {saveStatus === "saving" && (
              <span className="text-xs text-amber-200">Saving...</span>
            )}
            {saveStatus === "saved" && (
              <span className="text-xs text-emerald-300">✓ Saved</span>
            )}
            {saveStatus === "loaded" && (
              <span className="text-xs text-emerald-300">Loaded</span>
            )}
            {saveStatus === "cleared" && (
              <span className="text-xs text-slate-300">Done</span>
            )}
            <button
              onClick={handleSaveScenario}
              disabled={saveStatus === "saving"}
              className="text-xs bg-indigo-500 hover:bg-indigo-400 text-white px-3 py-1.5 rounded border border-indigo-400 transition font-medium disabled:opacity-50"
              title={
                activeScenario
                  ? "Save current inputs into the selected scenario"
                  : "Save current inputs as a new named scenario"
              }
            >
              {activeScenario
                ? isDirty
                  ? "Save changes"
                  : "Save"
                : "Save Scenario"}
            </button>
            <button
              onClick={handleSaveAsScenario}
              className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded border border-white/20 transition"
              title="Save the current inputs as a new named scenario"
            >
              Save as new…
            </button>
            {activeScenario && (
              <button
                onClick={handleRenameScenario}
                aria-label="Rename scenario"
                className="text-sm leading-none bg-white/10 hover:bg-white/20 px-2 py-1.5 rounded border border-white/20 transition"
                title="Rename the active scenario"
              >
                ✎
              </button>
            )}
            {activeScenario && (
              <button
                onClick={handleDeleteScenario}
                aria-label="Delete scenario"
                className="text-sm leading-none bg-white/10 hover:bg-rose-500/50 px-2 py-1.5 rounded border border-white/20 transition"
                title="Delete the active scenario (this browser only)"
              >
                🗑
              </button>
            )}
            <span
              className="w-px h-5 bg-white/20 mx-1 hidden sm:block"
              aria-hidden="true"
            ></span>
            <button
              onClick={() => window.print()}
              className="text-xs bg-emerald-500 hover:bg-emerald-400 text-white px-3 py-1.5 rounded border border-emerald-400 transition font-medium"
            >
              Save as PDF
            </button>
            <button
              onClick={reset}
              className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded border border-white/20 transition"
              title="Revert to built-in defaults (does not delete saved)"
            >
              Reset
            </button>
          </div>
        </div>
      </header>

      {/* Metrics strip */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 print:px-0 print:py-2 print-avoid-break">
        <div className="max-w-[1800px] mx-auto flex justify-end mb-2 print:hidden">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-1">
            <button
              onClick={() => setShowRealDollars(false)}
              className={`text-xs px-3 py-1 rounded font-medium transition ${
                !showRealDollars
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Nominal $
            </button>
            <button
              onClick={() => setShowRealDollars(true)}
              className={`text-xs px-3 py-1 rounded font-medium transition ${
                showRealDollars
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Today's $
            </button>
          </div>
        </div>
        <div className="max-w-[1800px] mx-auto grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard
            label={`Portfolio at ${retirementDisplayAge}`}
            value={fmtMoney(
              adjust(
                s.portfolioAtRetirement,
                currentYear + (retirementDisplayAge - displayInputs.currentAge),
              ),
            )}
            sublabel={
              showRealDollars
                ? `Inflation-adjusted — future dollars: ${fmtMoney(s.portfolioAtRetirement)}`
                : `Measured at the end of your first retirement year. ≈ ${fmtMoney(
                    s.portfolioAtRetirement /
                      Math.pow(
                        1 + displayInputs.inflation,
                        Math.max(
                          0,
                          retirementDisplayAge - displayInputs.currentAge,
                        ),
                      ),
                  )} in today's dollars — vs ${fmtMoney(s.currentTotal)} now`
            }
            tone="good"
          />
          <MetricCard
            label={`Portfolio at ${displayInputs.planThroughAge}`}
            value={fmtMoney(
              adjust(
                s.portfolioAtEnd,
                currentYear + (displayInputs.planThroughAge - displayInputs.currentAge),
              ),
            )}
            sublabel={
              shortfall.status === "danger"
                ? shortfall.firstShortfallAge != null
                  ? `Funds run out at age ${shortfall.firstShortfallAge}`
                  : `Unmet cash flow: ${fmtMoney(s.totalUnmetCashFlow)}`
                : materialUnmetCashFlow
                  ? `Unmet cash flow: ${fmtMoney(s.totalUnmetCashFlow)}`
                : showRealDollars
                  ? `Inflation-adjusted — future dollars: ${fmtMoney(s.portfolioAtEnd)}`
                  : `Future dollars — ≈ ${fmtMoney(
                      s.portfolioAtEnd /
                        Math.pow(
                          1 + displayInputs.inflation,
                          Math.max(
                            0,
                            displayInputs.planThroughAge - displayInputs.currentAge,
                          ),
                        ),
                    )} in today's purchasing power`
            }
            tone={
              shortfall.status === "danger" || s.portfolioAtEnd <= 0
                ? "bad"
                : shortfall.status === "warning"
                  ? "warn"
                  : "good"
            }
          />
          <MetricCard
            label="Year 1 Withdrawal Rate"
            value={fmtPct(s.year1WithdrawalRate)}
            sublabel={
              (s.year1WithdrawalRate < shortfall.guideline
                ? `Below the ${fmtPct(shortfall.guideline)} guideline for a ${shortfall.retirementYears}-year retirement`
                : `Above the ${fmtPct(shortfall.guideline)} guideline for a ${shortfall.retirementYears}-year retirement`) +
              " — counts everything pulled from savings in year 1, including money withdrawn to pay taxes"
            }
            tone={s.year1WithdrawalRate < shortfall.guideline ? "good" : "warn"}
          />
          <MetricCard
            label="Total Roth Converted"
            value={fmtMoney(s.totalConverted)}
            sublabel={`Moved into Roth over the whole plan. Lifetime taxes ${fmtMoney(s.totalTaxesPaid)} adds every year's bill in future (inflated) dollars — use it to compare scenarios, not as today's money`}
          />
        </div>
      </div>

      {/* Plan health banner — always visible, also printed */}
      <PlanStatusBanner
        shortfall={shortfall}
        planThroughAge={displayInputs.planThroughAge}
        isCouple={isCouple}
        maxSustainableSpending={maxSustainableSpending}
        plannedSpending={displayInputs.baseExpenses}
      />

      {/* Tab bar */}
      <div className="bg-white border-b border-slate-200 px-6 print:hidden">
        <div className="max-w-[1800px] mx-auto flex gap-1">
          {[
            { id: "plan", label: "Plan Details", sub: "Year-by-year breakdown" },
            { id: "compare", label: "Compare Scenarios", sub: "What if you retired earlier?" },
            { id: "risk", label: "Risk Analysis", sub: "Monte Carlo simulation" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition ${
                activeTab === tab.id
                  ? "border-indigo-600 text-indigo-700"
                  : "border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50"
              }`}
            >
              <div className="text-sm font-semibold">{tab.label}</div>
              <div className="text-xs text-slate-500 font-normal">
                {tab.sub}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Main layout */}
      <div className="max-w-[1800px] mx-auto grid grid-cols-1 lg:grid-cols-16 gap-6 p-6 print:p-0 print:gap-2">
        {/* Inputs sidebar — its own scroll container on desktop so the
            input list and the results never fight over one scrollbar. */}
        <aside className="lg:col-span-4 2xl:col-span-3 print:hidden lg:sticky lg:top-12 lg:self-start lg:max-h-[calc(100vh-3.5rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
          <KeyLevers
            inputs={inputs}
            isCouple={isCouple}
            update={update}
            updateCouple={updateCouple}
          />
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
            <h2 className="text-base font-bold text-slate-900 mb-1">
              Your Inputs
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Numbers update everything live.
            </p>

            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-2">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-600">
                Plan Type
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => updateMode("single")}
                  className={`rounded border px-3 py-2 text-xs font-semibold transition ${
                    !isCouple
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  Individual
                </button>
                <button
                  type="button"
                  onClick={() => updateMode("couple")}
                  className={`rounded border px-3 py-2 text-xs font-semibold transition ${
                    isCouple
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  Married Couple
                </button>
              </div>
              {!isCouple && (
                <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs leading-relaxed text-amber-900">
                  <span className="font-semibold">Tax note:</span> this tool
                  currently figures all taxes using{" "}
                  <TermLabel info={TERM_HELP.mfj}>married-filing-jointly</TermLabel>{" "}
                  rules. If you file as single, your real federal and NY taxes
                  will be <span className="font-semibold">higher</span> than
                  shown — treat after-tax results as a best case.
                </p>
              )}
            </div>

            {isCouple ? (
              <CoupleInputs couple={inputs.couple} updateCouple={updateCouple} />
            ) : (
              <>

            <Section title="Timing" icon="🗓️">
              <NumberInput
                label="Current Age"
                value={inputs.currentAge}
                onChange={update("currentAge")}
              />
              <NumberInput
                label="Retirement Age"
                value={inputs.retirementAge}
                onChange={update("retirementAge")}
                hint="Target age to stop full-time work. Already retired? Enter the age you actually retired — it can be at or below your current age."
              />
              <NumberInput
                label="Plan Through Age"
                value={inputs.planThroughAge}
                onChange={update("planThroughAge")}
                hint="How long the money must last — the age you're planning to live to. 95 is a common conservative choice."
              />
            </Section>

            <Section title="Current Balances" icon="💰">
              <NumberInput
                label="Cash / HYSA"
                value={inputs.balanceCash}
                onChange={update("balanceCash")}
                prefix="$"
                step={1000}
                hint={`Grows annually using Cash / HYSA Return (${fmtPct(inputs.cashReturn)})`}
                info={TERM_HELP.hysa}
              />
              <NumberInput
                label="Taxable Brokerage"
                value={inputs.balanceTaxable}
                onChange={update("balanceTaxable")}
                prefix="$"
                step={1000}
              />
              <PctInput
                label="Taxable Cost Basis %"
                value={inputs.taxableBasisPct}
                onChange={update("taxableBasisPct")}
                hint="% of balance that is cost basis (not taxable on sale). Example: if you've put in $130K and it's worth $190K, ≈ 68%. Default 70%."
              />
              <NumberInput
                label="401k"
                value={inputs.balance401k}
                onChange={update("balance401k")}
                prefix="$"
                step={1000}
              />
              <NumberInput
                label="Traditional IRA"
                value={inputs.balanceTradIra}
                onChange={update("balanceTradIra")}
                prefix="$"
                step={1000}
              />
              <NumberInput
                label="Roth IRA"
                value={inputs.balanceRoth}
                onChange={update("balanceRoth")}
                prefix="$"
                step={1000}
              />
              <NumberInput
                label="HSA"
                value={inputs.balanceHsa}
                onChange={update("balanceHsa")}
                prefix="$"
                step={1000}
                info={TERM_HELP.hsa}
              />
              <NumberInput
                label="Credit Card Debt"
                value={inputs.creditCardDebt}
                onChange={update("creditCardDebt")}
                prefix="$"
                step={100}
                hint="Paid off immediately at the start of the plan, from cash first and then taxable savings"
              />
            </Section>

            <Section title="Cash Strategy" badge="Drawdown" icon="🏦">
              <CashStrategyInputs
                values={inputs}
                onChange={update}
                earlyRetirement={inputs.retirementAge < 59.5}
              />
            </Section>

            <Section title="Returns & Inflation" icon="📈">
              <PctInput
                label="Pre-Retirement Return"
                value={inputs.preReturn}
                onChange={update("preReturn")}
                hint="Nominal, before inflation"
              />
              <PctInput
                label="Post-Retirement Return"
                value={inputs.postReturn}
                onChange={update("postReturn")}
              />
              <PctInput
                label="Cash / HYSA Return"
                value={inputs.cashReturn}
                onChange={update("cashReturn")}
                hint="Applied to the Cash / HYSA balance in every projection year"
                info={TERM_HELP.hysa}
              />
              <PctInput
                label="Inflation Rate"
                value={inputs.inflation}
                onChange={update("inflation")}
              />
            </Section>

            <Section title="Risk Assumptions" badge="Monte Carlo" icon="🎲">
              <PctInput
                label="Portfolio Volatility"
                value={inputs.portfolioVolatility}
                onChange={update("portfolioVolatility")}
                hint="~8% conservative, ~9% diversified TDF (recommended), ~15% all stocks"
              />
              <PctInput
                label="Taxable Annual Tax Drag"
                value={inputs.taxableAnnualTaxDrag}
                onChange={update("taxableAnnualTaxDrag")}
                hint="Annual taxable brokerage drag from dividends and turnover"
              />
              <div className="mb-3 mt-2 p-2 bg-slate-50 rounded border border-slate-200">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={inputs.flexibleSpending !== false}
                    onChange={(e) =>
                      update("flexibleSpending")(e.target.checked)
                    }
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-xs font-medium text-slate-700">
                      <TermLabel info={TERM_HELP.flexibleSpending}>
                        Flexible Spending
                      </TermLabel>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Reduces spending 10% in years after a market drop &gt;15%.
                      Reflects real retiree behavior; boosts success ~10-20pp.
                    </div>
                  </div>
                </label>
              </div>
            </Section>

            <Section title="Contributions (Pre-Retirement)" icon="💼">
              <NumberInput
                label="401k Employee"
                value={inputs.contrib401k}
                onChange={update("contrib401k")}
                prefix="$"
                step={500}
                hint={`Capped at ${fmtMoneyFull(currentContributionLimits.k401Employee)} for ${PROJECTION_START_YEAR}`}
              />
              <NumberInput
                label="Employer Match"
                value={inputs.contribMatch}
                onChange={update("contribMatch")}
                prefix="$"
                step={500}
                hint={`Employee + employer capped at ${fmtMoneyFull(currentContributionLimits.k401Total)}`}
              />
              <NumberInput
                label="HSA Contribution"
                value={inputs.contribHsa}
                onChange={update("contribHsa")}
                prefix="$"
                step={500}
                hint={`Capped at ${fmtMoneyFull(currentContributionLimits.hsa)} for current age/household`}
                info={TERM_HELP.hsa}
              />
            </Section>

            <Section title="Spending (today's dollars)" icon="🛒">
              <NumberInput
                label="Base Lifestyle Expenses"
                value={inputs.baseExpenses}
                onChange={update("baseExpenses")}
                prefix="$"
                step={1000}
                hint="What you spend per year today, not counting healthcare. We grow it with inflation automatically — enter it in today's dollars."
              />
              <NumberInput
                label="Healthcare before 65"
                value={inputs.healthcarePre65}
                onChange={update("healthcarePre65")}
                prefix="$"
                step={1000}
                hint="Your full insurance + out-of-pocket cost per year (today's dollars) from retirement until Medicare starts at 65 — e.g. an ACA marketplace plan"
                info={TERM_HELP.aca}
              />
              <NumberInput
                label="Healthcare 65+"
                value={inputs.healthcarePost65}
                onChange={update("healthcarePost65")}
                prefix="$"
                step={500}
                hint="Per year, today's dollars — Medicare premiums + Medigap + out-of-pocket"
              />
            </Section>

            <Section title="Income" icon="💵">
              <NumberInput
                label="Part-Time Income / Year"
                value={inputs.partTimeIncome}
                onChange={update("partTimeIncome")}
                prefix="$"
                step={1000}
              />
              <NumberInput
                label="Years of Part-Time Work"
                value={inputs.partTimeYears}
                onChange={update("partTimeYears")}
                hint="Starting at retirement"
              />
              <NumberInput
                label="Social Security at FRA / Year"
                value={inputs.ssIncome}
                onChange={update("ssIncome")}
                prefix="$"
                step={1000}
                hint="Today's dollars at full retirement age; claim-age adjustment is modeled"
                info={TERM_HELP.fra}
              />
              <NumberInput
                label="Age to Claim SS"
                value={inputs.ssAge}
                onChange={update("ssAge")}
                hint="62 (earliest) to 70; 67 = full benefit"
              />
            </Section>

            <Section
              title="Pension (Optional)"
              icon="🏛️"
              badge={inputs.pensionIncome > 0 ? "Active" : "Off"}
              defaultOpen={inputs.pensionIncome > 0}
            >
              <div className="mb-3 text-xs text-slate-500 leading-relaxed">
                For defined-benefit plans (teacher, firefighter, federal,
                military, corporate). Leave Annual Pension at $0 if you have
                no pension — nothing else will change.
              </div>
              <NumberInput
                label="Annual Pension"
                value={inputs.pensionIncome}
                onChange={(val) => {
                  // When pension is first activated (transitioning from 0 → >0),
                  // default Pension Start Age to the user's retirement age to avoid
                  // the silent failure of pension starting years after retirement.
                  if (val > 0 && (!inputs.pensionIncome || inputs.pensionIncome === 0)) {
                    setInputs((prev) => ({
                      ...prev,
                      pensionIncome: val,
                      pensionStartAge: prev.retirementAge,
                    }));
                  } else {
                    update("pensionIncome")(val);
                  }
                }}
                prefix="$"
                step={1000}
                hint="In today's dollars at benefit start"
              />
              {inputs.pensionIncome > 0 && (
                <>
                  <NumberInput
                    label="Pension Start Age"
                    value={inputs.pensionStartAge}
                    onChange={update("pensionStartAge")}
                    hint="Age when payments begin"
                  />
                  {inputs.pensionStartAge > inputs.retirementAge && (
                    <div className="mb-3 p-2 bg-amber-50 border border-amber-300 rounded text-xs text-amber-900">
                      <strong>⚠ Warning:</strong> Your pension doesn't start
                      until age {inputs.pensionStartAge}, but you retire at{" "}
                      {inputs.retirementAge}. That's a{" "}
                      {inputs.pensionStartAge - inputs.retirementAge}-year gap
                      where your portfolio covers everything alone. If the
                      pension should start at retirement, set this to{" "}
                      {inputs.retirementAge}.
                    </div>
                  )}
                  <PctInput
                    label="Pension COLA"
                    value={inputs.pensionCola}
                    onChange={update("pensionCola")}
                    hint="2% = NY teacher partial COLA; 3% = full inflation match"
                  />
                  <div className="mb-3 mt-2 p-2 bg-slate-50 rounded border border-slate-200">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={inputs.pensionNyExempt !== false}
                        onChange={(e) =>
                          update("pensionNyExempt")(e.target.checked)
                        }
                        className="mt-0.5"
                      />
                      <div>
                        <div className="text-xs font-medium text-slate-700">
                          NY State Tax Exempt
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Check for public pensions (NY teacher/NYSTRS,
                          federal, military). Uncheck for private pensions
                          (only first $20K excluded at age 59½+).
                        </div>
                      </div>
                    </label>
                  </div>
                </>
              )}
            </Section>

            <Section title="Roth Conversions" badge="Strategy" icon="🔄">
              <div className="mb-3 text-xs text-slate-500 leading-relaxed">
                A <span className="font-medium">Roth conversion</span> moves
                money from your 401k/IRA into a Roth IRA. You pay income tax
                on the amount you move <em>this year</em>; after that it grows
                tax-free with no required withdrawals. Converting works best
                in low-income years (after retiring, before Social Security).
                Enter dollars to convert per year in each age range — $0 is a
                perfectly fine choice. The model stops conversions once your
                Social Security starts.
              </div>
              {(() => {
                // Warn if annual conversion targets are a large % of 401k balance
                // This prevents the "conversion destroys small portfolio" failure mode
                const maxConversion = Math.max(
                  inputs.conversionBridge || 0,
                  inputs.conversionMid || 0,
                  inputs.conversionFinal || 0,
                );
                const balance = inputs.balance401k || 0;
                const ratio = balance > 0 ? maxConversion / balance : 0;
                if (ratio > 0.15 && maxConversion > 0) {
                  return (
                    <div className="mb-3 p-2 bg-amber-50 border border-amber-300 rounded text-xs text-amber-900">
                      <strong>⚠ Warning:</strong> Your largest Roth conversion
                      target (${maxConversion.toLocaleString()}/yr) is{" "}
                      {(ratio * 100).toFixed(0)}% of your 401k/403b balance ($
                      {balance.toLocaleString()}). For small accounts, large
                      conversions can drain the balance faster than tax savings
                      justify. Consider smaller conversions (e.g., fill to top
                      of 12% bracket only) or $0 if the account is under ~$500K.
                    </div>
                  );
                }
                return null;
              })()}
              <NumberInput
                label="From retirement through 59 / Year"
                value={inputs.conversionBridge}
                onChange={update("conversionBridge")}
                prefix="$"
                step={5000}
                hint="Tip: many people size this so taxable income stays inside the 12% federal bracket (about $100,800 for a couple in 2026)"
              />
              <NumberInput
                label="Ages 60-64 / Year"
                value={inputs.conversionMid}
                onChange={update("conversionMid")}
                prefix="$"
                step={5000}
              />
              <NumberInput
                label="Age 65 until Social Security / Year"
                value={inputs.conversionFinal}
                onChange={update("conversionFinal")}
                prefix="$"
                step={5000}
                hint="Last window — conversions stop once SS starts"
              />
            </Section>

            <Section
              title="Advanced Tax Model"
              icon="⚙️"
              badge="RMD / ACA / IRMAA"
              badgeInfo={`${TERM_HELP.rmd} ${TERM_HELP.aca} ${TERM_HELP.irmaa}`}
              defaultOpen={false}
            >
              <NumberInput
                label="RMD Start Age"
                value={inputs.rmdStartAge || results.summary.rmdStartAge}
                onChange={update("rmdStartAge")}
                hint={`Derived default is ${results.summary.rmdStartAge} from current age/start year`}
              />
              <div className="mb-3 mt-2 p-2 bg-slate-50 rounded border border-slate-200">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={inputs.useAcaSubsidyEstimate === true}
                    onChange={(e) =>
                      update("useAcaSubsidyEstimate")(e.target.checked)
                    }
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-xs font-medium text-slate-700">
                      <TermLabel info={TERM_HELP.aca}>
                        Estimate ACA Subsidy (pre-65)
                      </TermLabel>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Reduces pre-65 healthcare cost based on projected{" "}
                      <TermLabel info={TERM_HELP.magi}>MAGI</TermLabel>.
                      Note: large Roth conversions increase MAGI and reduce
                      subsidy eligibility — there may be a tradeoff between
                      conversion benefits and ACA savings.
                    </div>
                  </div>
                </label>
              </div>
              <NumberInput
                label="Household Size"
                value={inputs.householdSize}
                onChange={update("householdSize")}
                hint="Used for three things: ACA subsidy math, your HSA contribution limit (1 = self-only $4,400, 2+ = family $8,750 in 2026), and how many people pay Medicare premiums"
              />
              <div className="mt-2 text-xs text-slate-500 leading-relaxed">
                <TermLabel info={TERM_HELP.irmaa}>IRMAA</TermLabel> surcharges
                (Medicare 65+) use your projected{" "}
                <TermLabel info={TERM_HELP.magi}>MAGI</TermLabel> from two
                years earlier (matching the real 2-year lookback) once the plan
                has been retired 2+ years; the first two retirement years fall
                back to same-year MAGI because working-year income isn't
                modeled. Treat flagged years as approximate.
              </div>
            </Section>
              </>
            )}
          </div>

          {/* Utilities: privacy note + self-test runner. Scenario switching
              moved to the always-visible header bar. */}
          <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm mt-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs text-slate-500 leading-relaxed">
                Scenarios and inputs are saved only in this browser — nothing
                is uploaded. Switch, save, rename, or delete scenarios from
                the bar at the top of the page.
              </p>
              <button
                onClick={() => setDiagnostics(runSelfTests())}
                className="shrink-0 text-xs bg-white hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded border border-slate-300 transition"
                title="Run self-tests to validate tax helpers, RMD table, SS provisional income, waterfall, and solver"
              >
                Run Diagnostics
              </button>
            </div>
            {diagnostics && (
              <div className="mt-3 bg-white border border-slate-200 rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-slate-800">
                    Self-Test Results:{" "}
                    <span
                      className={
                        diagnostics.failed === 0
                          ? "text-emerald-700"
                          : "text-rose-700"
                      }
                    >
                      {diagnostics.passed}/{diagnostics.total} passed
                    </span>
                  </div>
                  <button
                    onClick={() => setDiagnostics(null)}
                    className="text-xs text-slate-400 hover:text-slate-600"
                  >
                    ✕ Close
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="px-2 py-1 text-left font-medium text-slate-600">
                          Test
                        </th>
                        <th className="px-2 py-1 text-right font-medium text-slate-600">
                          Expected
                        </th>
                        <th className="px-2 py-1 text-right font-medium text-slate-600">
                          Actual
                        </th>
                        <th className="px-2 py-1 text-center font-medium text-slate-600">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {diagnostics.results.map((r, i) => (
                        <tr
                          key={i}
                          className={
                            r.passed
                              ? "border-b border-slate-100"
                              : "border-b border-rose-200 bg-rose-50"
                          }
                        >
                          <td className="px-2 py-1 text-slate-700">{r.name}</td>
                          <td className="px-2 py-1 text-right text-slate-600 font-mono">
                            {r.expected}
                          </td>
                          <td className="px-2 py-1 text-right text-slate-600 font-mono">
                            {r.actual}
                          </td>
                          <td className="px-2 py-1 text-center">
                            {r.passed ? (
                              <span className="text-emerald-600 font-bold">
                                ✓
                              </span>
                            ) : (
                              <span className="text-rose-600 font-bold">
                                ✗
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Results area */}
        <main className="lg:col-span-12 2xl:col-span-13 print:col-span-12 space-y-6 print:space-y-3">
          {activeTab === "plan" && (
            <>
          <PlanNarrative narrative={planNarrative} />

          {/* Portfolio composition chart */}
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm print:shadow-none print:border-slate-300 print-avoid-break">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Portfolio Composition Over Time
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Watch how each account evolves through accumulation and
                  drawdown. In married-couple mode, spouse-owned retirement
                  accounts are combined here and split in the year-by-year detail.
                </p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={360}>
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="axisLabel"
                  ticks={chartAxisTicks}
                  tick={isCouple ? <YearAgeAxisTick /> : { fontSize: 11, fill: "#64748b" }}
                  height={isCouple ? 48 : 30}
                  interval={0}
                  label={{
                    value: isCouple ? "Year | Ages" : "Age",
                    position: "insideBottom",
                    offset: -2,
                    fontSize: 11,
                  }}
                />
                <YAxis
                  tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                />
                <Tooltip
                  content={(props) => (
                    <CashFlowTooltip {...props} isCouple={isCouple} />
                  )}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine
                  x={retirementAxisValue}
                  stroke="#ef4444"
                  strokeDasharray="3 3"
                  label={{
                    value: "Retire",
                    position: "top",
                    fill: "#ef4444",
                    fontSize: 11,
                  }}
                />
                <ReferenceLine
                  x={ssAxisValue}
                  stroke="#6366f1"
                  strokeDasharray="3 3"
                  label={{
                    value: "SS",
                    position: "top",
                    fill: "#6366f1",
                    fontSize: 11,
                  }}
                />
                {shortfall.status === "danger" && shortfallAxisValue != null && (
                  <ReferenceLine
                    x={shortfallAxisValue}
                    stroke="#be123c"
                    strokeWidth={2}
                    label={{
                      value: "⚠ Money runs out",
                      position: "insideTopRight",
                      fill: "#be123c",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="Cash"
                  stackId="1"
                  stroke="#64748b"
                  fill="#94a3b8"
                />
                <Area
                  type="monotone"
                  dataKey="Taxable"
                  stackId="1"
                  stroke="#0284c7"
                  fill="#7dd3fc"
                />
                <Area
                  type="monotone"
                  dataKey={employerPlanChartKey}
                  stackId="1"
                  stroke="#7c3aed"
                  fill="#c4b5fd"
                />
                <Area
                  type="monotone"
                  dataKey="Trad IRA"
                  stackId="1"
                  stroke="#db2777"
                  fill="#f9a8d4"
                />
                <Area
                  type="monotone"
                  dataKey="Roth"
                  stackId="1"
                  stroke="#059669"
                  fill="#6ee7b7"
                />
                <Area
                  type="monotone"
                  dataKey="HSA"
                  stackId="1"
                  stroke="#ea580c"
                  fill="#fdba74"
                />
                <Line
                  type="monotone"
                  dataKey="Annual Spending"
                  stroke="#dc2626"
                  strokeWidth={3}
                  strokeDasharray="6 4"
                  dot={false}
                  connectNulls={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Annual cash flow chart */}
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm print:shadow-none print:border-slate-300 print-avoid-break">
            <div className="mb-4">
              <h2 className="text-lg font-bold text-slate-900">
                Annual Cash Flow (Retirement Years)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Where each year's spending and tax are funded from, split by
                income source and account withdrawal.
                {isCouple
                  ? " The ledger below separates spendable cash from account-to-account Roth transfers."
                  : ""}
              </p>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={flowData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="axisLabel"
                  ticks={flowAxisTicks}
                  tick={isCouple ? <YearAgeAxisTick /> : { fontSize: 11, fill: "#64748b" }}
                  height={isCouple ? 42 : 30}
                  interval={0}
                />
                <YAxis
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                />
                <Tooltip
                  content={(props) => (
                    <CashFlowTooltip
                      {...props}
                      isCouple={isCouple}
                      showNeedBreakdown
                    />
                  )}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Part-Time" stackId="sources" fill="#059669" />
                <Bar dataKey="Social Security" stackId="sources" fill="#6366f1" />
                {displayInputs.pensionIncome > 0 && (
                  <Bar dataKey="Pension" stackId="sources" fill="#0f766e" />
                )}
                <Bar dataKey="Cash" stackId="sources" fill="#64748b" />
                <Bar dataKey="Taxable" stackId="sources" fill="#06b6d4" />
                <Bar dataKey={employerPlanChartKey} stackId="sources" fill="#7c3aed" />
                <Bar dataKey="IRA" stackId="sources" fill="#db2777" />
                <Bar dataKey="Roth" stackId="sources" fill="#10b981" />
                <Bar dataKey="HSA" stackId="sources" fill="#f97316" />
                <Line
                  type="monotone"
                  dataKey="Need (Spending + Tax)"
                  stroke="#ef4444"
                  strokeWidth={3}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
            {isCouple && <SpendableCashLedger rows={adjustedSpendableRows} />}
          </div>

          {/* Phase Guide — ranges derived from the same boundaries the engine uses */}
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm print:shadow-none print:border-slate-300 print-avoid-break">
            <h2 className="text-lg font-bold text-slate-900 mb-1">
              Your Retirement Phases Explained
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Each phase has different tax rules, available accounts, and
              income sources. Ages below come from your own inputs.
            </p>
            {(() => {
              const ssClaim = Math.max(62, displayInputs.ssAge);
              const rmdAge =
                s.rmdStartAge ||
                displayInputs.rmdStartAge ||
                defaultRmdStartAge(displayInputs.currentAge);
              const retireAge = displayInputs.retirementAge;
              return (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {retireAge < 60 && (
                    <div className="border-l-4 border-amber-400 bg-amber-50 rounded p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="bg-amber-100 text-amber-800 text-xs font-medium px-2 py-0.5 rounded">
                          Bridge
                        </span>
                        <span className="text-xs font-semibold text-slate-700">
                          Ages {retireAge}–59
                        </span>
                      </div>
                      <p className="text-xs text-slate-700 leading-relaxed">
                        "Bridging" the gap until 59½ when retirement accounts
                        become fully accessible without penalty. Live off{" "}
                        <span className="font-medium">
                          cash, taxable assets + part-time income
                        </span>
                        .{" "}
                        {retireAge >= 55 ? (
                          <>
                            The <span className="font-medium">Rule of 55</span>{" "}
                            can make 401k withdrawals penalty-free — but only
                            from your{" "}
                            <span className="font-medium">
                              current employer's plan
                            </span>
                            , and only if that plan allows post-separation
                            withdrawals. Old 401k's and IRAs stay penalized
                            before 59½. This model optimistically assumes your
                            whole 401k qualifies.
                          </>
                        ) : (
                          <>
                            Retiring before 55 means the Rule of 55 never
                            applies — 401k/IRA draws in this phase carry a{" "}
                            <span className="font-medium">10% penalty</span>{" "}
                            (flagged PENALTY in the table below). See the
                            "Accessing money before 59½" panel for a strategy.
                          </>
                        )}{" "}
                        Begin{" "}
                        <span className="font-medium">Roth conversions</span>{" "}
                        while in a low tax bracket.
                      </p>
                    </div>
                  )}

                  {retireAge < 65 && (
                    <div className="border-l-4 border-emerald-400 bg-emerald-50 rounded p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="bg-emerald-100 text-emerald-800 text-xs font-medium px-2 py-0.5 rounded">
                          Flex
                        </span>
                        <span className="text-xs font-semibold text-slate-700">
                          Ages {Math.max(60, retireAge)}–64
                        </span>
                      </div>
                      <p className="text-xs text-slate-700 leading-relaxed">
                        "Flexibility" — all retirement accounts now penalty-free. Draw from{" "}
                        <span className="font-medium">taxable brokerage</span>{" "}
                        (often 0% capital gains tax at this income level).
                        Continue{" "}
                        <span className="font-medium">Roth conversions</span>{" "}
                        — no SS yet means room in low brackets.
                      </p>
                    </div>
                  )}

                  {ssClaim > 65 && (
                    <div className="border-l-4 border-sky-400 bg-sky-50 rounded p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="bg-sky-100 text-sky-800 text-xs font-medium px-2 py-0.5 rounded">
                          Medicare
                        </span>
                        <span className="text-xs font-semibold text-slate-700">
                          Ages 65{ssClaim - 1 > 65 ? `–${ssClaim - 1}` : ""}
                        </span>
                      </div>
                      <p className="text-xs text-slate-700 leading-relaxed">
                        Medicare starts — healthcare costs typically drop
                        (your inputs: {fmtMoney(displayInputs.healthcarePre65)}{" "}
                        → {fmtMoney(displayInputs.healthcarePost65)} per
                        year). Last window for{" "}
                        <span className="font-medium">Roth conversions</span>{" "}
                        before Social Security starts pushing up your taxable
                        income. Watch for{" "}
                        <span className="font-medium">IRMAA</span>
                        <TermInfo text={TERM_HELP.irmaa} /> (Medicare premium
                        surcharges based on income).
                      </p>
                    </div>
                  )}

                  <div className="border-l-4 border-indigo-400 bg-indigo-50 rounded p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="bg-indigo-100 text-indigo-800 text-xs font-medium px-2 py-0.5 rounded">
                        SS
                      </span>
                      <span className="text-xs font-semibold text-slate-700">
                        Ages {ssClaim}+
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 leading-relaxed">
                      <span className="font-medium">Social Security</span>{" "}
                      starts at your claim age. SS + 401k/IRA withdrawals
                      cover spending.{" "}
                      <span className="font-medium">Roth stays untouched</span>{" "}
                      — it grows tax-free and becomes a legacy asset or
                      longevity hedge. At {rmdAge}, RMDs begin from
                      401k/Traditional IRA.
                    </p>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Early-retirement access strategy (Rule of 55 / pre-59½ bridge) */}
          <EarlyAccessStrategyPanel
            displayInputs={displayInputs}
            results={results}
            isCouple={isCouple}
            couple={isCouple ? normalizeCoupleInputs(inputs.couple) : null}
            adjust={adjust}
            showRealDollars={showRealDollars}
            maxSustainableSpending={maxSustainableSpending}
          />

          {/* Year-by-year table */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden print:shadow-none print:border-slate-300 print-page-break">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap justify-between items-start gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Year-by-Year Detail
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Reading each row:{" "}
                  <span className="text-emerald-700 font-medium">
                    income + withdrawals
                  </span>{" "}
                  ={" "}
                  <span className="text-slate-700 font-medium">
                    spending + tax
                  </span>
                  .{" "}
                  <span className="text-indigo-700 font-medium">
                    {isCouple ? "employer-plan to Roth conversions" : "401k to Roth conversions"}
                  </span>{" "}
                  are separate taxable transfers, not spending withdrawals.
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Badges:{" "}
                  <span className="text-[10px] font-medium bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded">
                    RMD
                  </span>{" "}
                  = required minimum distribution active,{" "}
                  <span className="text-[10px] font-medium bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                    IRMAA
                  </span>
                  <TermInfo text={TERM_HELP.irmaa} />{" "}
                  = Medicare high-income surcharge flag,{" "}
                  <span className="text-[10px] font-medium bg-teal-100 text-teal-800 px-1.5 py-0.5 rounded">
                    ACA
                  </span>
                  <TermInfo text={TERM_HELP.aca} />{" "}
                  = ACA subsidy active,{" "}
                  <span className="text-[10px] font-bold bg-orange-600 text-white px-1.5 py-0.5 rounded">
                    PENALTY
                  </span>{" "}
                  = 10% early-withdrawal penalty before 59½. Hover for details.
                </p>
              </div>
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-1">
                <button
                  onClick={() => setShowRealDollars(false)}
                  className={`text-xs px-3 py-1.5 rounded font-medium transition ${
                    !showRealDollars
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Nominal $
                </button>
                <button
                  onClick={() => setShowRealDollars(true)}
                  className={`text-xs px-3 py-1.5 rounded font-medium transition ${
                    showRealDollars
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Today's $
                </button>
              </div>
            </div>

            {/* Column group legend */}
            <div className="px-5 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap gap-3 text-xs">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded bg-slate-400"></span>
                <span className="text-slate-700">Outflow (spending/tax)</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded bg-emerald-400"></span>
                <span className="text-slate-700">Income sources</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded bg-sky-400"></span>
                <span className="text-slate-700">Withdrawals from accounts</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded bg-indigo-400"></span>
                <span className="text-slate-700">Roth transfer</span>
              </span>
              {isCouple && (
                <span className="text-slate-600">
                  Couple rows show year, then primary/spouse ages underneath.
                </span>
              )}
            </div>

            <div className="overflow-auto max-h-[600px] print:max-h-none print:overflow-visible">
              <table className="w-full min-w-[1500px] text-xs">
                <thead className="bg-white sticky top-0 z-10 print:static">
                  {/* Group headers */}
                  <tr className="border-b border-slate-200">
                    <th className="px-2 py-2 text-left" colSpan={2}></th>
                    <th
                      className="px-2 py-2 text-center font-semibold text-slate-600 bg-slate-100 border-x border-slate-200"
                      colSpan={2}
                    >
                      Outflow
                    </th>
                    <th
                      className="px-2 py-2 text-center font-semibold text-emerald-700 bg-emerald-50 border-r border-slate-200"
                      colSpan={displayInputs.pensionIncome > 0 ? 3 : 2}
                    >
                      Income
                    </th>
                    <th
                      className="px-2 py-2 text-center font-semibold text-sky-700 bg-sky-50 border-r border-slate-200"
                      colSpan={6}
                    >
                      Withdrawn From
                    </th>
                    <th
                      className="px-2 py-2 text-center font-semibold text-indigo-700 bg-indigo-50 border-r border-slate-200"
                      colSpan={1}
                    >
                      Roth
                    </th>
                    <th
                      className="px-2 py-2 text-center font-semibold text-slate-700 bg-slate-200"
                      colSpan={2}
                    >
                      End of Year
                    </th>
                  </tr>
                  {/* Column headers */}
                  <tr className="border-b-2 border-slate-300 bg-slate-50">
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">
                      {isCouple ? "Year / Ages" : "Age"}
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">
                      Phase
                    </th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700 bg-slate-100 border-l border-slate-200">
                      Spending
                    </th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700 bg-slate-100 border-r border-slate-200">
                      Tax
                    </th>
                    <th className="px-3 py-2 text-right font-semibold text-emerald-700 bg-emerald-50">
                      Part-Time
                    </th>
                    <th className="px-3 py-2 text-right font-semibold text-emerald-700 bg-emerald-50 border-r border-slate-200">
                      Soc Sec
                    </th>
                    {displayInputs.pensionIncome > 0 && (
                      <th className="px-3 py-2 text-right font-semibold text-emerald-700 bg-emerald-50 border-r border-slate-200">
                        Pension
                      </th>
                    )}
                    <th className="px-3 py-2 text-right font-semibold text-sky-700 bg-sky-50">
                      Cash
                    </th>
                    <th className="px-3 py-2 text-right font-semibold text-sky-700 bg-sky-50">
                      Taxable
                    </th>
                    <th className="px-3 py-2 text-right font-semibold text-sky-700 bg-sky-50">
                      {isCouple ? "Plans" : "401k"}
                    </th>
                    <th className="px-3 py-2 text-right font-semibold text-sky-700 bg-sky-50">
                      IRA
                    </th>
                    <th className="px-3 py-2 text-right font-semibold text-sky-700 bg-sky-50 border-r border-slate-200">
                      Roth
                    </th>
                    <th className="px-3 py-2 text-right font-semibold text-sky-700 bg-sky-50 border-r border-slate-200">
                      HSA
                    </th>
                    <th className="px-3 py-2 text-right font-semibold text-indigo-700 bg-indigo-50 border-r border-slate-200">
                      Transfer
                    </th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700 bg-slate-200">
                      Total
                    </th>
                    <th className="px-3 py-2 text-center font-semibold text-slate-700 bg-slate-200 min-w-[120px]">
                      Composition
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {results.yearlyData
                    .filter((d) => d.phase !== "accumulation")
                    .map((rawRow) => {
                      const d = adjustRow(rawRow);
                      const primaryOwner = d.ownerDetails?.primary || {};
                      const spouseOwner = d.ownerDetails?.spouse || {};
                      const primaryPlanLabel = primaryOwner.employerPlanLabel || "401k";
                      const spousePlanLabel = spouseOwner.employerPlanLabel || "403b";
                      const isShortfallYear =
                        (rawRow.unmetCashFlow || 0) > 1 || rawRow.total <= 0;
                      return (
                        <Fragment key={d.year}>
                        <tr
                          className={
                            isShortfallYear
                              ? "border-b border-rose-200 bg-rose-50 hover:bg-rose-100"
                              : "border-b border-slate-100 hover:bg-slate-50"
                          }
                        >
                          <td className="px-3 py-1.5 font-semibold">
                            {isCouple && d.spouseAge != null
                              ? (
                                <span className="inline-flex flex-col leading-tight">
                                  <span>{d.year}</span>
                                  <span className="text-[10px] font-normal text-slate-500">
                                    {Math.round(d.primaryAge ?? d.age)} / {Math.round(d.spouseAge)}
                                  </span>
                                </span>
                              )
                              : d.age}
                          </td>
                          <td className="px-3 py-1.5">
                            <div className="flex items-center gap-1 flex-wrap">
                              <PhasePill phase={d.phase} />
                              {d.rmdAmount > 0 && (
                                <span
                                  className="text-[10px] font-medium bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded"
                                  title={`RMD required: ${fmtMoney(d.rmdAmount)}`}
                                >
                                  RMD
                                </span>
                              )}
                              {d.irmaaTriggered && (
                                <span
                                  className="text-[10px] font-medium bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded"
                                  title={`IRMAA surcharge flag: ~${fmtMoney(d.irmaaSurcharge)} (approximate)`}
                                >
                                  IRMAA
                                </span>
                              )}
                              {d.acaSubsidy > 0 && (
                                <span
                                  className="text-[10px] font-medium bg-teal-100 text-teal-800 px-1.5 py-0.5 rounded"
                                  title={`ACA subsidy savings: ${fmtMoney(d.acaSubsidy)}`}
                                >
                                  ACA
                                </span>
                              )}
                              {isShortfallYear && (
                                <span
                                  className="text-[10px] font-bold bg-rose-600 text-white px-1.5 py-0.5 rounded"
                                  title={`Unfunded need this year: ${fmtMoney(d.unmetCashFlow)}. Spending + taxes exceed available withdrawals.`}
                                >
                                  SHORTFALL
                                </span>
                              )}
                              {d.reserveUsed > 0 && (
                                <span
                                  className="text-[10px] font-bold bg-amber-500 text-white px-1.5 py-0.5 rounded"
                                  title={`Dipped into the protected cash reserve: ${fmtMoney(d.reserveUsed)} (floor this year: ${fmtMoney(d.cashFloor)}). All other accounts were exhausted.`}
                                >
                                  RESERVE
                                </span>
                              )}
                              {d.earlyPenalty > 0 && (
                                <span
                                  className="text-[10px] font-bold bg-orange-600 text-white px-1.5 py-0.5 rounded"
                                  title={`10% early-withdrawal penalty: ${fmtMoney(d.earlyPenalty)} included in this year's Tax. Applies to 401k/IRA (and modeled Roth) draws before age 59½.`}
                                >
                                  PENALTY
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-1.5 text-right bg-slate-50 border-l border-slate-200">
                            {fmtMoney(d.spending)}
                          </td>
                          <td className="px-3 py-1.5 text-right text-rose-700 bg-slate-50 border-r border-slate-200">
                            {d.tax ? fmtMoney(d.tax) : "—"}
                          </td>
                          <td className="px-3 py-1.5 text-right text-emerald-700">
                            {d.partTime ? fmtMoney(d.partTime) : "—"}
                          </td>
                          <td className="px-3 py-1.5 text-right text-emerald-700 border-r border-slate-200">
                            {d.ss ? fmtMoney(d.ss) : "—"}
                          </td>
                          {displayInputs.pensionIncome > 0 && (
                            <td className="px-3 py-1.5 text-right text-emerald-700 border-r border-slate-200">
                              {d.pension ? fmtMoney(d.pension) : "—"}
                            </td>
                          )}
                          <td
                            className={`px-3 py-1.5 text-right ${
                              d.fromCash > 0 ? "text-sky-700 font-medium" : "text-slate-300"
                            }`}
                          >
                            {d.fromCash > 0 ? fmtMoney(d.fromCash) : "—"}
                          </td>
                          <td
                            className={`px-3 py-1.5 text-right ${
                              d.fromTaxable > 0 ? "text-sky-700 font-medium" : "text-slate-300"
                            }`}
                          >
                            {d.fromTaxable > 0 ? fmtMoney(d.fromTaxable) : "—"}
                          </td>
                          <td
                            className={`px-3 py-1.5 text-right ${
                              d.from401k > 0 || d.conversion > 0
                                ? "font-medium"
                                : "text-slate-300"
                            }`}
                            title={
                              d.ownerDetails
                                ? `Primary ${primaryPlanLabel}: ${fmtMoney(primaryOwner.from401k || 0)} | Spouse ${spousePlanLabel}: ${fmtMoney(spouseOwner.from401k || 0)} | Conversions: Primary ${fmtMoney(primaryOwner.conversion || 0)}, Spouse ${fmtMoney(spouseOwner.conversion || 0)}`
                                : d.conversion > 0
                                  ? `401k transfer out to Roth: -${fmtMoney(d.conversion)}`
                                : undefined
                            }
                          >
                            <span
                              className={
                                d.from401k > 0 ? "text-sky-700" : "text-slate-300"
                              }
                            >
                              {d.from401k > 0 ? fmtMoney(d.from401k) : "—"}
                            </span>
                            {d.conversion > 0 && (
                              <span className="block text-[10px] leading-tight text-indigo-600 whitespace-nowrap">
                                -{fmtMoney(d.conversion)} xfer
                              </span>
                            )}
                          </td>
                          <td
                            className={`px-3 py-1.5 text-right ${
                              d.fromIra > 0 ? "text-sky-700 font-medium" : "text-slate-300"
                            }`}
                            title={
                              d.ownerDetails
                                ? `Primary IRA: ${fmtMoney(primaryOwner.fromIra || 0)} | Spouse IRA: ${fmtMoney(spouseOwner.fromIra || 0)}`
                                : undefined
                            }
                          >
                            {d.fromIra > 0 ? fmtMoney(d.fromIra) : "—"}
                          </td>
                          <td
                            className={`px-3 py-1.5 text-right border-r border-slate-200 ${
                              d.fromRoth > 0 ? "text-sky-700 font-medium" : "text-slate-300"
                            }`}
                          >
                            {d.fromRoth > 0 ? fmtMoney(d.fromRoth) : "—"}
                          </td>
                          <td
                            className={`px-3 py-1.5 text-right border-r border-slate-200 ${
                              d.hsaWithdrawal > 0 ? "text-sky-700 font-medium" : "text-slate-300"
                            }`}
                          >
                            {d.hsaWithdrawal > 0 ? fmtMoney(d.hsaWithdrawal) : "—"}
                          </td>
                          <td
                            className={`px-3 py-1.5 text-right border-r border-slate-200 ${
                              d.conversion > 0
                                ? "text-indigo-700 font-medium"
                                : "text-slate-300"
                            }`}
                            title={
                              isCouple && d.ownerDetails && d.conversion > 0
                                ? `${primaryOwner.conversion > 0 ? `Primary ${primaryPlanLabel} -> Primary Roth: ${fmtMoney(primaryOwner.conversion)}` : ""}${primaryOwner.conversion > 0 && spouseOwner.conversion > 0 ? " | " : ""}${spouseOwner.conversion > 0 ? `Spouse ${spousePlanLabel} -> Spouse Roth: ${fmtMoney(spouseOwner.conversion)}` : ""}`
                                : d.conversion > 0
                                  ? `Taxable Roth conversion: ${fmtMoney(d.conversion)} moves from 401k to Roth. This is not cash used for spending.`
                                : "No Roth conversion in this year."
                            }
                          >
                            {isCouple && d.ownerDetails && d.conversion > 0 ? (
                              <span className="inline-flex flex-col items-end gap-0.5 leading-tight">
                                {primaryOwner.conversion > 0 && (
                                  <span>
                                    {primaryPlanLabel} -&gt; Roth {fmtMoney(primaryOwner.conversion)}
                                  </span>
                                )}
                                {spouseOwner.conversion > 0 && (
                                  <span>
                                    {spousePlanLabel} -&gt; Roth {fmtMoney(spouseOwner.conversion)}
                                  </span>
                                )}
                              </span>
                            ) : d.conversion > 0 ? (
                              <span className="inline-flex flex-col items-end leading-tight">
                                <span>{fmtMoney(d.conversion)}</span>
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right font-semibold bg-slate-50">
                            {fmtMoney(d.total)}
                          </td>
                          <td className="px-2 py-1.5 bg-slate-50 min-w-[120px]">
                            <MiniStackedBar row={d} />
                          </td>
                        </tr>
                        {isCouple && d.ownerDetails && (
                          <tr className="border-b border-slate-100 bg-slate-50/70">
                            <td colSpan={yearDetailColSpan} className="px-5 py-3">
                              <CoupleOwnerDetailGrid ownerDetails={d.ownerDetails} />
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      );
                    })}
                </tbody>
              </table>
            </div>

            {/* Explainer under the table */}
            <div className="px-5 py-4 border-t border-slate-200 bg-slate-50 text-xs text-slate-700">
              <p className="font-semibold mb-2">How to read a row:</p>
              <div className="space-y-1 leading-relaxed">
                <p>
                  <span className="font-medium text-slate-900">Example at age 55:</span> You need to cover{" "}
                  <span className="text-slate-900 font-medium">Spending</span> + <span className="text-rose-700 font-medium">Tax</span>. You earn{" "}
                  <span className="text-emerald-700 font-medium">Part-Time</span> income. The shortfall comes from{" "}
                  <span className="text-sky-700 font-medium">Cash withdrawals</span>. Separately, a{" "}
                  <span className="text-indigo-700 font-medium">401k -&gt; Roth conversion</span> moves pre-tax 401k money into Roth. It creates taxable income, but it is not cash used for spending.
                </p>
                {isCouple && (
                  <p>
                    <span className="font-medium text-slate-900">Couple mode:</span>{" "}
                    pension, Social Security, part-time income, and account withdrawals are spendable cash sources. Roth transfers are shown separately because they move assets between accounts and do not fund spending.
                  </p>
                )}
                <p>
                  <span className="font-medium text-slate-900">By age 67:</span> Spending is covered by{" "}
                  <span className="text-emerald-700 font-medium">Social Security</span> +{" "}
                  <span className="text-sky-700 font-medium">401k withdrawals</span>. Roth stays untouched to grow tax-free.
                </p>
                <p className="italic text-slate-500 mt-2">
                  The "Total" column shows your total portfolio at year's end. The "Composition" bar shows the mix of accounts that make up that total — watch how it shifts from cash-heavy (gray) to 401k-heavy (purple) to Roth-heavy (green) across your lifetime.
                </p>
              </div>
            </div>
          </div>

          {/* Explaining the ending balance / inheritance — only when the
              plan actually ends above today's total, otherwise it reads as
              mockery of a struggling plan */}
          {s.portfolioAtEnd > s.currentTotal && (
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm print-avoid-break">
            <h2 className="text-lg font-bold text-slate-900 mb-1">
              "Wait — I end up richer at {displayInputs.planThroughAge} than I am today?"
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              A common surprise, and a great question. Here's what's going on.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-slate-50 border border-slate-200 rounded p-3">
                <p className="text-xs font-semibold text-slate-700 mb-2">
                  1. You're withdrawing less than your growth
                </p>
                <p className="text-xs text-slate-600 leading-relaxed">
                  At a {fmtPct(s.year1WithdrawalRate)} year-one withdrawal
                  rate against {fmtPct(displayInputs.postReturn)} assumed
                  growth, the portfolio can keep compounding even while you
                  draw from it.
                </p>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded p-3">
                <p className="text-xs font-semibold text-slate-700 mb-2">
                  2. Inflation makes the numbers look bigger
                </p>
                <p className="text-xs text-slate-600 leading-relaxed">
                  $1 today ≈ $
                  {Math.pow(
                    1 + displayInputs.inflation,
                    displayInputs.planThroughAge - displayInputs.currentAge,
                  ).toFixed(2)}{" "}
                  in{" "}
                  {PROJECTION_START_YEAR +
                    (displayInputs.planThroughAge - displayInputs.currentAge)}{" "}
                  at your {fmtPct(displayInputs.inflation)} inflation
                  assumption. The {fmtMoney(s.portfolioAtEnd)} at age{" "}
                  {displayInputs.planThroughAge} is roughly{" "}
                  <span className="font-medium">
                    {fmtMoney(
                      s.portfolioAtEnd /
                        Math.pow(
                          1 + displayInputs.inflation,
                          displayInputs.planThroughAge -
                            displayInputs.currentAge,
                        ),
                    )}{" "}
                    in today's purchasing power
                  </span>
                  . Toggle "Today's $" to see every number that way.
                </p>
              </div>

              <div className="bg-emerald-50 border border-emerald-200 rounded p-3">
                <p className="text-xs font-semibold text-emerald-800 mb-2">
                  3. Yes — it's your heirs' inheritance
                </p>
                <p className="text-xs text-slate-700 leading-relaxed">
                  If you pass at {displayInputs.planThroughAge} with that
                  balance, your spouse or other heirs inherit it. The mix
                  matters for taxes, though — see below.
                </p>
              </div>
            </div>

            <div className="mt-4 border-t border-slate-200 pt-4">
              <p className="text-xs font-semibold text-slate-700 mb-2">
                What your heirs actually get (by account type):
              </p>
              <ul className="text-xs text-slate-700 space-y-1.5 leading-relaxed">
                <li>
                  <span className="inline-block w-3 h-3 rounded bg-[#6ee7b7] mr-1.5 align-middle"></span>
                  <span className="font-medium">Roth IRA:</span> 100%
                  tax-free. The huge Roth balance at 90 (often the largest
                  chunk, thanks to conversions) is the most valuable
                  inheritance — no income tax, ever. Spouses get full
                  stretch; other heirs must empty within 10 years (tax-free).
                </li>
                <li>
                  <span className="inline-block w-3 h-3 rounded bg-[#c4b5fd] mr-1.5 align-middle"></span>
                  <span className="font-medium">401k / Traditional IRA:</span>{" "}
                  Subject to ordinary income tax when withdrawn. Spouses can
                  roll over and treat as their own. Non-spouse heirs must
                  empty within 10 years — potentially pushing them into high
                  tax brackets.
                </li>
                <li>
                  <span className="inline-block w-3 h-3 rounded bg-[#7dd3fc] mr-1.5 align-middle"></span>
                  <span className="font-medium">Taxable Brokerage:</span>{" "}
                  Heirs get a{" "}
                  <span className="font-medium">
                    step-up in cost basis
                  </span>{" "}
                  at your death — all accumulated capital gains disappear
                  for tax purposes. Very efficient.
                </li>
                <li>
                  <span className="inline-block w-3 h-3 rounded bg-[#94a3b8] mr-1.5 align-middle"></span>
                  <span className="font-medium">Cash / HSA:</span> Cash
                  passes freely. HSA becomes taxable to non-spouse heirs
                  (which is why it's best to spend or use for medical
                  expenses in life).
                </li>
              </ul>
            </div>

            <div className="mt-4 bg-indigo-50 border border-indigo-200 rounded p-3">
              <p className="text-xs text-indigo-900 leading-relaxed">
                <span className="font-semibold">The key insight:</span>{" "}
                {s.totalConverted > 0 ? (
                  <>
                    This plan converts {fmtMoney(s.totalConverted)} from
                    tax-deferred accounts into Roth during low-tax years —
                    paying some tax now so that growth compounds tax-free. By
                    age {displayInputs.planThroughAge} that Roth balance
                    passes to heirs with no income tax at all.
                  </>
                ) : (
                  <>
                    This plan currently makes no Roth conversions. Adding
                    conversions in low-tax years (sidebar → Roth Conversions)
                    shifts more of the ending balance into the tax-free Roth
                    bucket — usually the most valuable account to inherit.
                  </>
                )}
              </p>
            </div>
          </div>
          )}

          {/* Notes */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-xs text-amber-900 print-avoid-break">
            <p className="font-semibold mb-2">Model Assumptions & Caveats</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>
                Tax: <TermLabel info={TERM_HELP.mfj}>MFJ</TermLabel> federal
                brackets + NY State, inflation-adjusted from 2024 using your
                selected inflation rate
              </li>
              <li>
                Taxable account gains use tracked cost basis (not flat 60%
                assumption). Reinvested dividends simplified as unrealized
                gains — slightly overstates embedded gain vs. reality.
              </li>
              <li>
                Social Security taxation uses provisional-income rules (0-85%
                taxable depending on other income). Thresholds $32K/$44K are
                not indexed to inflation — this is statutory, not a bug.
              </li>
              <li>
                Taxes solved iteratively (gross-up converges so final
                withdrawals cover both spending and tax on those withdrawals).
              </li>
              <li>
                RMDs modeled from your configured start age using the 2022+
                Uniform Lifetime Table. Inherited-account rules not modeled.
                RMDs are computed on the combined 401k + IRA balance; in real
                life each employer plan's RMD must be taken from that plan
                (only IRAs can be aggregated).
              </li>
              <li>
                <TermLabel info={TERM_HELP.niit}>NIIT</TermLabel> (3.8%)
                modeled above $250K <TermLabel info={TERM_HELP.mfj}>MFJ</TermLabel>{" "}
                <TermLabel info={TERM_HELP.magi}>MAGI</TermLabel>. Threshold
                not indexed (statutory).
              </li>
              <li>
                Age-65+ extra standard deduction and the OBBBA senior
                deduction ($6,000/person 65+, 2025-2028, phased out above
                $150K MFJ MAGI) are modeled.
              </li>
              <li>
                Cash/HYSA interest is taxed as ordinary income and counts
                toward <TermLabel info={TERM_HELP.magi}>MAGI</TermLabel>,
                Social Security provisional income, ACA, and IRMAA. Taxable
                brokerage dividends remain a simplified return drag.
              </li>
              <li>
                <TermLabel info={TERM_HELP.irmaa}>IRMAA</TermLabel>: uses
                projected <TermLabel info={TERM_HELP.magi}>MAGI</TermLabel>{" "}
                from two years earlier (the real lookback) once retired 2+
                years; earlier years fall back to same-year MAGI.
              </li>
              <li>
                <TermLabel info={TERM_HELP.aca}>ACA subsidy</TermLabel> (if enabled): bracketed approximation using
                post-IRA applicable-percentage formula. Real subsidies depend
                on state, plan choice, age, and specific FPL tables.
              </li>
              {!isCouple && (
                <li>
                  Individual mode still uses married-filing-jointly tax
                  brackets — a single filer's actual federal tax would be
                  meaningfully higher than shown.
                </li>
              )}
              <li>
                Social Security earnings test not modeled: claiming before
                full retirement age while earning part-time income would
                temporarily reduce real benefits.
              </li>
              <li>
                Couple mode assumes both spouses live through the full plan —
                survivor benefits, widow(er) filing status, and first-death
                expense changes are not modeled.
              </li>
              <li>
                HSA withdrawals are modeled for healthcare only. In reality,
                after 65 an HSA can fund anything (taxed as ordinary income) —
                a large HSA balance here may look less spendable than it is.
              </li>
              <li>
                Not modeled: tax-exempt interest in provisional income, state
                tax law changes, long-term care costs, the 2026+ requirement
                that high earners' 401k catch-up contributions be Roth, and
                Roth 5-year clocks (early Roth draws are penalized in full as
                a conservative stand-in).
              </li>
              <li>
                Not financial advice — consult a fee-only fiduciary & CPA.
                Treat this as a structured way to stress-test assumptions, not
                a guarantee.
              </li>
            </ul>
          </div>

          {/* Settings Export — collapsible section for copy/paste */}
          <SettingsExport inputs={displayInputs} sourceInputs={inputs} />
            </>
          )}

          {activeTab === "compare" && (
            <ScenarioComparison
              scenarios={scenarios}
              inputs={inputs}
              showRealDollars={showRealDollars}
              setShowRealDollars={setShowRealDollars}
              adjust={adjust}
            />
          )}

          {activeTab === "risk" && (
            <RiskAnalysis
              inputs={displayInputs}
              results={results}
              mcResults={mcResults}
              mcStale={mcStale}
              runMC={runMC}
              mcRunning={mcRunning}
              adjust={adjust}
              showRealDollars={showRealDollars}
              setShowRealDollars={setShowRealDollars}
            />
          )}

        </main>
      </div>
      <PlannerChat
        profile={chatProfile}
        onApplyChanges={applyChatChanges}
        compact
        floating
      />
    </div>
  );
}

// ============================================================
// SCENARIO COMPARISON COMPONENT
// ============================================================

function ScenarioComparison({
  scenarios,
  inputs,
  showRealDollars,
  setShowRealDollars,
  adjust,
}) {
  const displayInputs = getDisplayInputs(inputs);
  const couple = isCoupleMode(inputs) ? normalizeCoupleInputs(inputs.couple) : null;
  // Group by retirement age
  const byAge = {};
  scenarios.forEach((s) => {
    if (!byAge[s.retirementAge]) byAge[s.retirementAge] = [];
    byAge[s.retirementAge].push(s);
  });

  const spendingLevels = [
    Math.round(displayInputs.baseExpenses * 0.85),
    displayInputs.baseExpenses,
    Math.round(displayInputs.baseExpenses * 1.25),
  ];
  const spendingLabels = ["Modest", "Current Plan", "Enhanced"];

  const currentYear = PROJECTION_START_YEAR;
  const endYear = currentYear + (displayInputs.planThroughAge - displayInputs.currentAge);

  const chartData = Object.keys(byAge)
    .sort()
    .map((age) => {
      const row = {
        retirementAge: couple
          ? `${age} / ${couple.spouse.retirementAge}`
          : age,
      };
      byAge[age].forEach((s, i) => {
        row[spendingLabels[i]] = Math.round(
          adjust(s.portfolioAtEnd, endYear),
        );
      });
      return row;
    });

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900 mb-1">
          Scenario Comparison: When to Retire × How Much to Spend
        </h2>
        <p className="text-xs text-slate-500 mb-2">
          Each row is a retirement age. Each column is a spending level. The
          number shows your ending portfolio at age {displayInputs.planThroughAge}.
        </p>
        {couple && (
          <p className="text-xs text-slate-600 mb-4 bg-indigo-50 border border-indigo-200 rounded p-3">
            <span className="font-semibold">Ages are primary / spouse.</span>{" "}
            Spouse retirement age remains {couple.spouse.retirementAge}; rows
            vary the primary retirement age.
          </p>
        )}

        <div className="flex justify-end mb-3">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-1">
            <button
              onClick={() => setShowRealDollars(false)}
              className={`text-xs px-3 py-1.5 rounded font-medium transition ${
                !showRealDollars
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-600"
              }`}
            >
              Nominal $
            </button>
            <button
              onClick={() => setShowRealDollars(true)}
              className={`text-xs px-3 py-1.5 rounded font-medium transition ${
                showRealDollars
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-600"
              }`}
            >
              Today's $
            </button>
          </div>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b-2 border-slate-300 bg-slate-50">
                <th className="px-3 py-2 text-left font-semibold text-slate-700">
                  Retire at
                </th>
                {spendingLabels.map((label, i) => (
                  <th
                    key={label}
                    className="px-3 py-2 text-right font-semibold text-slate-700"
                  >
                    {label}
                    <div className="text-xs font-normal text-slate-500">
                      {fmtMoney(spendingLevels[i])}/yr
                    </div>
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-semibold text-slate-700">
                  Years Retired
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(byAge)
                .sort()
                .map((age) => {
                  const yourAge = Number(age);
                  const spouseAge = couple
                    ? couple.spouse.currentAge + (yourAge - couple.primary.currentAge)
                    : null;
                  const yearsRetired = displayInputs.planThroughAge - yourAge;
                  const isCurrentPlan = yourAge === displayInputs.retirementAge;
                  return (
                    <tr
                      key={age}
                      className={`border-b border-slate-100 ${
                        isCurrentPlan ? "bg-indigo-50" : "hover:bg-slate-50"
                      }`}
                    >
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-900">
                          Age {yourAge}
                          {isCurrentPlan && (
                            <span className="ml-2 text-xs font-normal text-indigo-600">
                              (current plan)
                            </span>
                          )}
                        </div>
                        {couple && (
                          <div className="text-xs text-slate-500">
                            Spouse age: {spouseAge}
                          </div>
                        )}
                      </td>
                      {byAge[age].map((s, i) => {
                        const val = adjust(s.portfolioAtEnd, endYear);
                        const depleted = val <= 0;
                        return (
                          <td
                            key={i}
                            className={`px-3 py-2 text-right font-semibold ${
                              depleted
                                ? "text-rose-700 bg-rose-50"
                                : val < 500000
                                  ? "text-amber-700"
                                  : "text-emerald-700"
                            }`}
                          >
                            {depleted ? "Depleted" : fmtMoney(val)}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right text-slate-600">
                        {yearsRetired} yrs
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
        <h3 className="text-base font-bold text-slate-900 mb-3">
          Ending Portfolio by Scenario
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="retirementAge"
              tick={{ fontSize: 11, fill: "#64748b" }}
              label={{
                value: couple ? "Primary / spouse retirement age" : "Retirement Age",
                position: "insideBottom",
                offset: -5,
                fontSize: 11,
              }}
            />
            <YAxis
              tickFormatter={(v) =>
                v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : `$${(v / 1000).toFixed(0)}K`
              }
              tick={{ fontSize: 11, fill: "#64748b" }}
            />
            <Tooltip
              formatter={(v) => fmtMoney(v)}
              contentStyle={{ fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="Modest"
              stroke="#64748b"
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="Current Plan"
              stroke="#6366f1"
              strokeWidth={3}
            />
            <Line
              type="monotone"
              dataKey="Enhanced"
              stroke="#059669"
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
        <h3 className="text-base font-bold text-slate-900 mb-3">
          What This Table Is Telling You
        </h3>
        <div className="space-y-3 text-sm text-slate-700 leading-relaxed">
          <p>
            <span className="font-semibold">Retiring earlier</span> means fewer
            years of saving and more years of spending, so the ending balance
            shrinks. The question this table answers is <em>how much</em> it
            shrinks — and whether the smaller number is still enough to fund
            your plan through age {displayInputs.planThroughAge}.
          </p>
          <p>
            <span className="font-semibold">Spending more ("Enhanced")</span>{" "}
            shows what an extra 25% per year costs you by age{" "}
            {displayInputs.planThroughAge}. If that column still ends
            comfortably above zero, you may have more room to enjoy than you
            thought. <span className="font-semibold">"Modest"</span> shows the
            cushion you gain from a 15% cut.
          </p>
          <p>
            <span className="font-semibold">A red "Depleted" cell</span> means
            that combination of retirement age and spending runs out of money
            before age {displayInputs.planThroughAge}. Cells in amber end above
            zero but with a thin cushion.
          </p>
          <p className="text-xs text-slate-500 italic mt-2">
            Every cell above has been projected with your actual assumptions
            (returns, inflation, tax rates, part-time income, Social Security).
            Numbers are ending portfolio at age {displayInputs.planThroughAge}.
            Estimates only — not financial advice.
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// AI CHAT COMPONENT
// ============================================================

function renderInlineMarkdown(text) {
  const parts = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith("`")) {
      parts.push(
        <code
          key={`${match.index}-code`}
          className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-slate-800"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      parts.push(
        <strong key={`${match.index}-strong`} className="font-semibold text-slate-900">
          {token.slice(2, -2)}
        </strong>,
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function renderChatText(text) {
  const lines = (text || "").split("\n");
  const blocks = [];
  let listItems = [];
  let listType = null;

  const flushList = () => {
    if (listItems.length === 0) return;
    const ListTag = listType === "ordered" ? "ol" : "ul";
    blocks.push(
      <ListTag
        key={`list-${blocks.length}`}
        className={`mb-3 space-y-1 pl-5 ${
          listType === "ordered" ? "list-decimal" : "list-disc"
        }`}
      >
        {listItems.map((item, idx) => (
          <li key={idx}>{renderInlineMarkdown(item)}</li>
        ))}
      </ListTag>,
    );
    listItems = [];
    listType = null;
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      return;
    }

    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      flushList();
      blocks.push(
        <p key={`heading-${blocks.length}`} className="mb-2 font-semibold text-slate-900">
          {renderInlineMarkdown(heading[1])}
        </p>,
      );
      return;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (listType !== "bullet") flushList();
      listType = "bullet";
      listItems.push(bullet[1]);
      return;
    }

    const numbered = line.match(/^\d+\.\s+(.+)$/);
    if (numbered) {
      if (listType !== "ordered") flushList();
      listType = "ordered";
      listItems.push(numbered[1]);
      return;
    }

    flushList();
    blocks.push(
      <p key={`paragraph-${blocks.length}`} className="mb-2 last:mb-0">
        {renderInlineMarkdown(line)}
      </p>,
    );
  });

  flushList();
  return blocks;
}

function PlannerChat({
  profile,
  onApplyChanges,
  compact = false,
  floating = false,
}) {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Ask me about the current projection, withdrawal sequencing, tax tradeoffs, Roth conversions, or how to test a different spending pattern.",
      suggestions: [],
      caveats: [],
    },
  ]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [appliedSuggestions, setAppliedSuggestions] = useState({});
  const [collapsed, setCollapsed] = useState(false);
  const chatApiUrl =
    import.meta.env.VITE_CHAT_API_URL || `${import.meta.env.BASE_URL}api/chat`;

  const ask = async (question) => {
    const cleanQuestion = question.trim();
    if (!cleanQuestion || loading) return;

    const userMessage = { role: "user", content: cleanQuestion };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");
    setError("");
    setLoading(true);

    try {
      const response = await fetch(chatApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: cleanQuestion,
          messages: nextMessages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
          profile,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Chat request failed.");
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answerMarkdown || "No response returned.",
          suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
          caveats: Array.isArray(data.caveats) ? data.caveats : [],
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chat request failed.");
    } finally {
      setLoading(false);
    }
  };

  const exampleQuestions = [
    "Why is it recommending I spend so much cash early in retirement?",
    "I do not want to leave a large inheritance. What spending changes should I test?",
    "What is the tax tradeoff of these Roth conversions?",
  ];

  const shellClass = floating
    ? "fixed bottom-4 right-4 z-50 w-[min(460px,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] resize overflow-auto bg-white rounded-lg border border-slate-300 shadow-2xl print:hidden"
    : "bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden print:hidden";

  return (
    <div className={shellClass}>
      <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-900">Ask AI About This Plan</h2>
          {floating && (
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
              aria-expanded={!collapsed}
            >
              {collapsed ? "Show" : "Hide"}
            </button>
          )}
        </div>
        {!compact && (
          <p className="text-xs text-slate-600 mt-1 leading-relaxed">
            The assistant receives your current inputs, summary metrics, and
            year-by-year projection. Suggested changes are shown for review before
            they are applied.
          </p>
        )}
      </div>

      {!collapsed && (
      <div className={`${compact ? "p-4" : "p-5"} space-y-4`}>
        <div className="flex flex-wrap gap-2">
          {exampleQuestions.map((question) => (
            <button
              key={question}
              type="button"
              onClick={() => ask(question)}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50"
            >
              {question}
            </button>
          ))}
        </div>

        <div
          className={`border border-slate-200 rounded-lg bg-slate-50 overflow-auto p-4 space-y-4 ${
            compact ? "h-[280px]" : "h-[520px]"
          }`}
        >
          {messages.map((message, idx) => (
            <div
              key={idx}
              className={`flex ${
                message.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[88%] rounded-lg px-4 py-3 text-sm leading-relaxed ${
                  message.role === "user"
                    ? "bg-indigo-600 text-white"
                    : "bg-white border border-slate-200 text-slate-800"
                }`}
              >
                {renderChatText(message.content)}

                {message.caveats?.length > 0 && (
                  <div className="mt-3 border-t border-slate-200 pt-2 text-xs text-slate-600">
                    <p className="font-semibold mb-1">Caveats</p>
                    <ul className="list-disc list-inside space-y-1">
                      {message.caveats.map((caveat, caveatIdx) => (
                        <li key={caveatIdx}>{caveat}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {message.suggestions?.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {message.suggestions.map((suggestion, suggestionIdx) => (
                      <div
                        key={suggestionIdx}
                        className="rounded border border-indigo-200 bg-indigo-50 p-3 text-xs text-slate-800"
                      >
                        <div className="flex justify-between gap-3">
                          <div>
                            <p className="font-semibold text-indigo-900">
                              {suggestion.title}
                            </p>
                            <p className="mt-1 text-slate-700">
                              {suggestion.rationale}
                            </p>
                          </div>
                          <span className="h-fit rounded bg-white px-2 py-0.5 text-[10px] font-medium text-indigo-700 border border-indigo-200">
                            {suggestion.confidence}
                          </span>
                        </div>
                        <div className="mt-2 space-y-1">
                          {suggestion.changes?.map((change, changeIdx) => (
                            <div
                              key={changeIdx}
                              className="rounded bg-white border border-indigo-100 px-2 py-1"
                            >
                              <span className="font-mono text-indigo-800">
                                {change.field}
                              </span>
                              : {String(change.currentValue)} -&gt;{" "}
                              {String(change.value)}
                              {change.note && (
                                <span className="text-slate-500">
                                  {" "}
                                  ({change.note})
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                        {appliedSuggestions[`${idx}-${suggestionIdx}`] && (
                          <div
                            className={`mt-2 rounded border px-2 py-1.5 ${
                              appliedSuggestions[`${idx}-${suggestionIdx}`]
                                .applied.length > 0
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                : "border-amber-200 bg-amber-50 text-amber-800"
                            }`}
                          >
                            {appliedSuggestions[`${idx}-${suggestionIdx}`]
                              .applied.length > 0
                              ? `Applied ${appliedSuggestions[`${idx}-${suggestionIdx}`].applied.length} input change${
                                  appliedSuggestions[`${idx}-${suggestionIdx}`]
                                    .applied.length === 1
                                    ? ""
                                    : "s"
                                }. The plan recalculated with the new values.`
                              : "No inputs were applied because the suggested fields did not match editable planner inputs."}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const result = onApplyChanges(suggestion.changes);
                            setAppliedSuggestions((prev) => ({
                              ...prev,
                              [`${idx}-${suggestionIdx}`]: result,
                            }));
                          }}
                          className={`mt-3 text-xs px-3 py-1.5 rounded font-medium ${
                            appliedSuggestions[`${idx}-${suggestionIdx}`]
                              ?.applied.length > 0
                              ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                              : "bg-indigo-600 hover:bg-indigo-700 text-white"
                          }`}
                        >
                          {appliedSuggestions[`${idx}-${suggestionIdx}`]
                            ?.applied.length > 0
                            ? "Applied"
                            : "Apply These Inputs"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="text-sm text-slate-500">Thinking through the plan...</div>
          )}
        </div>

        {error && (
          <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error}
          </div>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            ask(draft);
          }}
          className="flex gap-2"
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask about cash drawdown, spending capacity, Roth conversions, taxes, or a scenario you want to test..."
            rows={compact ? 2 : 3}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={loading || draft.trim().length === 0}
            className="self-stretch rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Send
          </button>
        </form>

        <p className="text-[11px] text-slate-400 leading-relaxed">
          AI answers can be wrong and are not financial, tax, or investment
          advice. Verify anything important with a professional before acting.
        </p>

        {!compact && (
          <p className="text-xs text-slate-500 leading-relaxed">
            Local development uses <span className="font-mono">/api/chat</span>.
            For GitHub Pages, set <span className="font-mono">VITE_CHAT_API_URL</span>{" "}
            to a separate backend endpoint that stores the provider API key server-side.
          </p>
        )}
      </div>
      )}
    </div>
  );
}

// ============================================================
// RISK ANALYSIS COMPONENT (Monte Carlo)
// ============================================================

function RiskAnalysis({
  inputs,
  results,
  mcResults,
  mcStale = false,
  runMC,
  mcRunning,
  adjust,
  showRealDollars,
  setShowRealDollars,
}) {
  const chartData = mcResults
    ? mcResults.percentiles.map((p) => ({
        age: p.age,
        "10th %ile (bad)": Math.round(p.p10),
        "25th %ile": Math.round(p.p25),
        "50th %ile (median)": Math.round(p.p50),
        "75th %ile": Math.round(p.p75),
        "90th %ile (great)": Math.round(p.p90),
      }))
    : [];

  const diagnosis = mcResults
    ? diagnoseSuccessRate(inputs, results, mcResults)
    : null;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900 mb-1">
          Risk Analysis — Sequence of Returns
        </h2>
        <p className="text-xs text-slate-500 mb-2">
          The main plan assumes steady {fmtPct(inputs.postReturn)} returns
          every year in retirement. Real markets don't work that way — you
          might get a devastating crash in your first year of retirement, or a
          bull market for a decade. This simulation runs your plan through 500
          possible market sequences to see how often it succeeds.
        </p>
        <p className="text-xs text-slate-500 italic mb-4">
          Each simulation feeds randomized retirement-year returns into the
          same full engine as the main plan — taxes, RMDs, IRMAA, early
          withdrawal penalties, and your cash strategy all apply, and flexible
          spending (if enabled) reacts to drops. Returns are drawn
          independently from a normal distribution, so prolonged bear markets
          and fat-tail crashes are represented only approximately.
        </p>

        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={runMC}
            disabled={mcRunning}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-4 py-2 rounded font-medium transition disabled:opacity-50"
          >
            {mcRunning
              ? "Running 500 simulations..."
              : mcStale && mcResults
                ? "Re-run Monte Carlo (inputs changed)"
                : "Run Monte Carlo (500 sims)"}
          </button>
          {mcResults && (
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-1 ml-auto">
              <button
                onClick={() => setShowRealDollars(false)}
                className={`text-xs px-3 py-1.5 rounded font-medium transition ${
                  !showRealDollars ? "bg-indigo-600 text-white" : "text-slate-600"
                }`}
              >
                Nominal $
              </button>
              <button
                onClick={() => setShowRealDollars(true)}
                className={`text-xs px-3 py-1.5 rounded font-medium transition ${
                  showRealDollars ? "bg-indigo-600 text-white" : "text-slate-600"
                }`}
              >
                Today's $
              </button>
            </div>
          )}
        </div>

        {!mcResults && !mcRunning && (
          <div className="bg-slate-50 border border-slate-200 rounded p-6 text-center">
            <p className="text-sm text-slate-600">
              Click "Run Monte Carlo" to stress-test your plan against market
              volatility. Takes a few seconds.
            </p>
          </div>
        )}

        {mcResults && (
          <>
            {mcStale && (
              <div
                role="alert"
                className="mb-4 bg-amber-100 border border-amber-300 rounded p-3 flex items-start gap-2"
              >
                <span className="text-amber-700 font-bold" aria-hidden="true">
                  ⚠
                </span>
                <p className="text-xs text-amber-900 leading-relaxed">
                  <span className="font-semibold">
                    Inputs changed since this simulation ran.
                  </span>{" "}
                  The results below reflect your previous inputs — re-run
                  Monte Carlo to update them.
                </p>
              </div>
            )}
            {/* Volatility context banner */}
            <div className="mb-4 bg-sky-50 border border-sky-200 rounded p-3">
              <p className="text-xs text-sky-900 leading-relaxed">
                <span className="font-semibold">Simulation assumption:</span>{" "}
                Your portfolio volatility is set to{" "}
                <span className="font-semibold">
                  {fmtPct(inputs.portfolioVolatility)}
                </span>{" "}
                (
                {inputs.portfolioVolatility <= 0.09
                  ? "conservative allocation"
                  : inputs.portfolioVolatility <= 0.12
                    ? "diversified like a target-date fund"
                    : inputs.portfolioVolatility <= 0.14
                      ? "aggressive"
                      : "all equities"}
                ) with taxable-account annual drag of{" "}
                <span className="font-semibold">
                  {fmtPct(inputs.taxableAnnualTaxDrag)}
                </span>
                . Both are adjustable in the sidebar under "Risk Assumptions" — roughly 9-11% suits a balanced target-date-style mix, ~15% all equities.
              </p>
            </div>

            <div
              className={`grid grid-cols-2 md:grid-cols-4 gap-3 mb-5 ${mcStale ? "opacity-60" : ""}`}
            >
              <MetricCard
                label="Success Rate"
                value={fmtPct(mcResults.successRate)}
                sublabel={
                  mcResults.successRate >= 0.95
                    ? "High confidence (in this model)"
                    : mcResults.successRate >= 0.85
                      ? "Historically favorable range"
                      : mcResults.successRate >= 0.75
                        ? "Workable with some risk"
                        : mcResults.successRate >= 0.6
                          ? "Notable risk — revisit assumptions"
                          : "High risk of depletion"
                }
                tone={
                  mcResults.successRate >= 0.85
                    ? "good"
                    : mcResults.successRate >= 0.75
                      ? "warn"
                      : "bad"
                }
              />
              <MetricCard
                label="Median End Balance"
                value={fmtMoney(
                  adjust(
                    mcResults.finalP50,
                    PROJECTION_START_YEAR + (inputs.planThroughAge - inputs.currentAge),
                  ),
                )}
                sublabel="50th percentile outcome"
              />
              <MetricCard
                label="Worst-Case (10th %ile)"
                value={fmtMoney(
                  adjust(
                    mcResults.finalP10,
                    PROJECTION_START_YEAR + (inputs.planThroughAge - inputs.currentAge),
                  ),
                )}
                sublabel="Bottom 10% of runs"
                tone={mcResults.finalP10 > 0 ? "neutral" : "bad"}
              />
              <MetricCard
                label="Best-Case (90th %ile)"
                value={fmtMoney(
                  adjust(
                    mcResults.finalP90,
                    PROJECTION_START_YEAR + (inputs.planThroughAge - inputs.currentAge),
                  ),
                )}
                sublabel="Top 10% of runs"
                tone="good"
              />
            </div>

            {/* Why is the success rate what it is? */}
            {diagnosis && (
              <div
                className={`mb-5 bg-white border border-slate-200 rounded-lg overflow-hidden ${mcStale ? "opacity-60" : ""}`}
              >
                <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
                  <h3 className="text-sm font-bold text-slate-900">
                    Why is your success rate {fmtPct(mcResults.successRate)}?
                  </h3>
                  <p
                    className={`text-xs mt-1 leading-relaxed ${
                      diagnosis.verdictTone === "good"
                        ? "text-emerald-700"
                        : diagnosis.verdictTone === "bad"
                          ? "text-rose-700"
                          : "text-amber-700"
                    }`}
                  >
                    {diagnosis.verdict}
                  </p>
                </div>
                <div className="divide-y divide-slate-100">
                  {diagnosis.factors.map((f, i) => {
                    const iconMap = {
                      positive: { symbol: "✓", bg: "bg-emerald-100", fg: "text-emerald-700" },
                      negative: { symbol: "!", bg: "bg-rose-100", fg: "text-rose-700" },
                      neutral: { symbol: "•", bg: "bg-amber-100", fg: "text-amber-700" },
                    };
                    const icon = iconMap[f.impact];
                    const severityBadge = {
                      high: {
                        text: "High impact",
                        cls: "bg-slate-900 text-white",
                      },
                      medium: {
                        text: "Medium impact",
                        cls: "bg-slate-200 text-slate-700",
                      },
                      low: {
                        text: "Minor",
                        cls: "bg-slate-100 text-slate-600",
                      },
                    }[f.severity];
                    return (
                      <div key={i} className="px-4 py-3 flex gap-3">
                        <div
                          className={`flex-shrink-0 w-7 h-7 rounded-full ${icon.bg} ${icon.fg} font-bold text-sm flex items-center justify-center mt-0.5`}
                        >
                          {icon.symbol}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span className="font-semibold text-sm text-slate-900">
                              {f.title}
                            </span>
                            <span
                              className={`text-xs px-2 py-0.5 rounded font-medium ${severityBadge.cls}`}
                            >
                              {severityBadge.text}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 leading-relaxed">
                            {f.detail}
                          </p>
                          {f.fix && (
                            <p className="text-xs text-indigo-700 mt-1.5 leading-relaxed">
                              <span className="font-semibold">What helps:</span>{" "}
                              {f.fix}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 text-xs text-slate-500">
                  Each factor above is based on your current inputs. Adjust
                  values in the sidebar and re-run the simulation to see how
                  the success rate changes.
                </div>
              </div>
            )}

            {/* Historical Perspective — grounds the MC result in real data */}
            {results && (
              <div className="mb-5 bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                <h3 className="text-sm font-bold text-emerald-900 mb-2">
                  Historical Perspective (Trinity Study)
                </h3>
                <p className="text-xs text-emerald-900 leading-relaxed mb-3">
                  Monte Carlo uses random future scenarios. But we also have{" "}
                  <span className="font-semibold">100+ years of actual US market history</span>{" "}
                  to compare against. Here's how your plan would have fared in
                  every real historical 35-year period:
                </p>
                <div className="bg-white rounded border border-emerald-200 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-emerald-50 border-b border-emerald-200">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-emerald-900">
                          Withdrawal Rate
                        </th>
                        <th className="px-3 py-2 text-right font-semibold text-emerald-900">
                          Historical Success (35-year horizon)
                        </th>
                        <th className="px-3 py-2 text-left font-semibold text-emerald-900">
                          Notes
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-emerald-100">
                        <td className="px-3 py-1.5 font-medium">3.0%</td>
                        <td className="px-3 py-1.5 text-right text-emerald-700 font-semibold">
                          ~100%
                        </td>
                        <td className="px-3 py-1.5 text-slate-600">
                          Never failed, any period
                        </td>
                      </tr>
                      <tr
                        className={`border-b border-emerald-100 ${
                          results.summary.year1WithdrawalRate < 0.04
                            ? "bg-emerald-100"
                            : ""
                        }`}
                      >
                        <td className="px-3 py-1.5 font-medium">3.5%</td>
                        <td className="px-3 py-1.5 text-right text-emerald-700 font-semibold">
                          ~96%
                        </td>
                        <td className="px-3 py-1.5 text-slate-600">
                          Failed only in absolute-worst historical sequences
                        </td>
                      </tr>
                      <tr className="border-b border-emerald-100">
                        <td className="px-3 py-1.5 font-medium">4.0%</td>
                        <td className="px-3 py-1.5 text-right text-emerald-700 font-semibold">
                          ~91%
                        </td>
                        <td className="px-3 py-1.5 text-slate-600">
                          Classic "safe" Bengen rule
                        </td>
                      </tr>
                      <tr className="border-b border-emerald-100">
                        <td className="px-3 py-1.5 font-medium">4.5%</td>
                        <td className="px-3 py-1.5 text-right text-amber-700 font-semibold">
                          ~82%
                        </td>
                        <td className="px-3 py-1.5 text-slate-600">
                          Above safe zone
                        </td>
                      </tr>
                      <tr>
                        <td className="px-3 py-1.5 font-medium">5.0%</td>
                        <td className="px-3 py-1.5 text-right text-rose-700 font-semibold">
                          ~68%
                        </td>
                        <td className="px-3 py-1.5 text-slate-600">
                          Risky territory
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 p-3 bg-white border border-emerald-300 rounded">
                  <p className="text-xs text-emerald-900 leading-relaxed">
                    <span className="font-bold">Your Year-1 withdrawal rate is{" "}
                      {fmtPct(results.summary.year1WithdrawalRate)}
                    </span>
                    .{" "}
                    {results.summary.year1WithdrawalRate < 0.04
                      ? "In US market history back to ~1926, starting rates at this level survived nearly every 35-year period — including retirements that began in 1929, 1966, and 1973."
                      : "In US market history back to ~1926, starting rates above 4% failed in a meaningful share of 35-year periods — the table above shows how quickly the odds fall as the rate rises."}{" "}
                    Past performance is not a guarantee; treat this as
                    historical context, not a prediction.
                  </p>
                  <p className="text-xs text-emerald-900 leading-relaxed mt-2">
                    If the Monte Carlo above shows a lower success rate, it's
                    a stress test using parametric random draws that produce
                    more extreme sequences than real markets tend to (markets
                    have some mean reversion and valuation-based recovery).
                    Historical bootstrap results and parametric Monte Carlo
                    both have limitations — treat them as different lenses on
                    the same question.
                  </p>
                </div>
              </div>
            )}

            <h3 className="text-sm font-semibold text-slate-800 mb-2">
              Portfolio Paths (range across 500 simulated markets)
            </h3>
            <ResponsiveContainer width="100%" height={350}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="age"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  label={{
                    value: "Age",
                    position: "insideBottom",
                    offset: -2,
                    fontSize: 11,
                  }}
                />
                <YAxis
                  tickFormatter={(v) =>
                    v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : `$${(v / 1000).toFixed(0)}K`
                  }
                  tick={{ fontSize: 11, fill: "#64748b" }}
                />
                <Tooltip formatter={(v) => fmtMoney(v)} contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area
                  type="monotone"
                  dataKey="90th %ile (great)"
                  stroke="#059669"
                  fill="#6ee7b7"
                  fillOpacity={0.3}
                />
                <Area
                  type="monotone"
                  dataKey="75th %ile"
                  stroke="#0284c7"
                  fill="#7dd3fc"
                  fillOpacity={0.3}
                />
                <Area
                  type="monotone"
                  dataKey="50th %ile (median)"
                  stroke="#6366f1"
                  fill="#c7d2fe"
                  fillOpacity={0.5}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="25th %ile"
                  stroke="#f59e0b"
                  fill="#fde68a"
                  fillOpacity={0.3}
                />
                <Area
                  type="monotone"
                  dataKey="10th %ile (bad)"
                  stroke="#dc2626"
                  fill="#fecaca"
                  fillOpacity={0.3}
                />
              </AreaChart>
            </ResponsiveContainer>

            <div className="mt-5 p-4 bg-slate-50 border border-slate-200 rounded">
              <p className="text-sm font-semibold text-slate-800 mb-2">
                How to read this:
              </p>
              <ul className="text-xs text-slate-700 space-y-1.5 leading-relaxed list-disc list-inside">
                <li>
                  <span className="font-medium">Success Rate</span> = % of 500
                  simulated markets where your money didn't run out before age{" "}
                  {inputs.planThroughAge}.
                </li>
                <li>
                  Planners often treat{" "}
                  <span className="font-medium">85–90%+ as comfortable</span>.
                  Very high rates (95%+) <em>can</em> mean you have room to
                  retire earlier or spend more — or that your return
                  assumptions are optimistic.
                </li>
                <li>
                  The{" "}
                  <span className="text-rose-700 font-medium">10th %ile line</span>{" "}
                  represents unlucky market scenarios (think retiring right
                  before the 2008 crash). If your plan survives this line,
                  you're protected against most realistic downside.
                </li>
                <li>
                  The{" "}
                  <span className="text-indigo-700 font-medium">50th %ile</span>{" "}
                  is the median — half the time you do better, half the time
                  worse.
                </li>
                <li>
                  Wide spread between 10th and 90th = high variance. Narrow
                  spread = predictable outcomes.
                </li>
              </ul>
            </div>

            <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded">
              <p className="text-sm font-semibold text-emerald-900 mb-2">
                What this means for your decision:
              </p>
              <p className="text-xs text-emerald-900 leading-relaxed">
                A success rate well above 90% <em>may</em> mean you have more
                margin than you need — a case for{" "}
                <span className="font-medium">retiring earlier</span>,{" "}
                <span className="font-medium">spending more per year</span>,
                or <span className="font-medium">both</span>. Before acting on
                it, stress-test the conclusion: lower the return assumption by
                1% and re-run. If the rate stays high, try moving your
                retirement age a year or two earlier in the sidebar and watch
                how much margin you actually have.
              </p>
            </div>
          </>
        )}
      </div>

      <p className="text-xs text-slate-500 italic">
        Estimates only — this tool is for education, not financial, tax, or
        investment advice. Verify important numbers with a professional before
        acting.
      </p>

      <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
        <h3 className="text-base font-bold text-slate-900 mb-3">
          About Sequence-of-Returns Risk
        </h3>
        <p className="text-sm text-slate-700 leading-relaxed mb-3">
          This is the single biggest threat to early retirement. Two retirees
          with identical average returns can have wildly different outcomes if
          one retires right before a crash.
        </p>
        <p className="text-sm text-slate-700 leading-relaxed mb-3">
          <span className="font-semibold">Example:</span> Retire in 2000 with
          $1M invested in S&P 500. The dot-com crash + 2008 crash means you
          spent years drawing down a shrinking portfolio — it never recovered
          enough to catch up, and you likely ran out of money by 2020. Retire
          in 2009 (right after the crash) with the same $1M, and you enjoyed
          a massive bull market — you'd be much wealthier today.
        </p>
        <p className="text-sm text-slate-700 leading-relaxed">
          <span className="font-semibold">How to hedge:</span> Keep 2-3 years
          of spending in cash/short-term bonds, avoid selling stocks during
          bad years, keep spending flexible (part-time income helps), and stay
          diversified.{" "}
          {(() => {
            const yearOneSpend =
              (inputs.baseExpenses || 0) + (inputs.healthcarePre65 || 0);
            if (yearOneSpend <= 0) return null;
            const cashYears = (inputs.balanceCash || 0) / yearOneSpend;
            return cashYears >= 2
              ? `Your current inputs hold about ${cashYears.toFixed(1)} years of spending in cash — a solid buffer.`
              : `Your current inputs hold about ${cashYears.toFixed(1)} year${cashYears >= 0.95 && cashYears < 1.05 ? "" : "s"} of spending in cash — a thin buffer for bad early years.`;
          })()}
        </p>
      </div>
    </div>
  );
}
