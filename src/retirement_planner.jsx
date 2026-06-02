import { useState, useMemo } from "react";
import {
  Area,
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

// ============================================================
// TAX CALCULATIONS (MFJ, inflation-adjusted from 2024 brackets)
// ============================================================

function fedOrdinaryTaxMFJ(taxableIncome, year) {
  if (taxableIncome <= 0) return 0;
  const inf = Math.pow(1.03, year - 2024);
  const brackets = [
    [0, 23200, 0.1],
    [23200, 94300, 0.12],
    [94300, 201050, 0.22],
    [201050, 383900, 0.24],
    [383900, 487450, 0.32],
    [487450, 731200, 0.35],
    [731200, Infinity, 0.37],
  ];
  let tax = 0;
  for (const [low, high, rate] of brackets) {
    const lowA = low * inf;
    const highA = high === Infinity ? Infinity : high * inf;
    if (taxableIncome > lowA) {
      tax += (Math.min(taxableIncome, highA) - lowA) * rate;
    }
    if (taxableIncome <= highA) break;
  }
  return tax;
}

function fedLtcgTaxMFJ(ltcg, ordinaryTaxable, year) {
  if (ltcg <= 0) return 0;
  const inf = Math.pow(1.03, year - 2024);
  const zeroTop = 94050 * inf;
  const fifteenTop = 583750 * inf;
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

function nyStateTaxMFJ(taxableIncome, year) {
  if (taxableIncome <= 0) return 0;
  const inf = Math.pow(1.03, year - 2024);
  const stdDed = 16050 * inf;
  const nyTaxable = Math.max(0, taxableIncome - stdDed);
  const brackets = [
    [0, 17150, 0.04],
    [17150, 23600, 0.045],
    [23600, 27900, 0.0525],
    [27900, 161550, 0.055],
    [161550, 323200, 0.06],
    [323200, 2155350, 0.0685],
  ];
  let tax = 0;
  for (const [low, high, rate] of brackets) {
    const lowA = low * inf;
    const highA = high * inf;
    if (nyTaxable > lowA) {
      tax += (Math.min(nyTaxable, highA) - lowA) * rate;
    }
    if (nyTaxable <= highA) break;
  }
  return tax;
}

function totalTax(ordinaryIncome, ltcg, year) {
  const inf = Math.pow(1.03, year - 2024);
  const stdDed = 29200 * inf;
  const taxableOrdinary = Math.max(0, ordinaryIncome - stdDed);
  const fedOrd = fedOrdinaryTaxMFJ(taxableOrdinary, year);
  const fedLtcg = fedLtcgTaxMFJ(ltcg, taxableOrdinary, year);
  const ny = nyStateTaxMFJ(ordinaryIncome + ltcg, year);
  return fedOrd + fedLtcg + ny;
}

// ============================================================
// SIMULATION
// ============================================================

function simulate(inputs) {
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
    conversionBridge,
    conversionMid,
    conversionFinal,
  } = inputs;

  const currentYear = 2026;
  const retirementYear = currentYear + (retirementAge - currentAge);
  const endYear = currentYear + (planThroughAge - currentAge);

  let bCash = balanceCash;
  let bTaxable = balanceTaxable;
  let b401k = balance401k;
  let bTradIra = balanceTradIra;
  let bRoth = balanceRoth;
  let bHsa = balanceHsa;

  const yearlyData = [];
  let totalTaxesPaid = 0;
  let totalConverted = 0;
  let depleted = false;

  for (let year = currentYear; year <= endYear; year++) {
    const age = currentAge + (year - currentYear);
    const isAccumulation = age < retirementAge;
    const yearsFromRetirement = Math.max(0, year - retirementYear);
    const inflMult = Math.pow(1 + inflation, yearsFromRetirement);

    if (isAccumulation) {
      b401k = b401k * (1 + preReturn) + contrib401k + contribMatch;
      bTaxable = bTaxable * (1 + preReturn);
      bTradIra = bTradIra * (1 + preReturn);
      bRoth = bRoth * (1 + preReturn);
      bHsa = bHsa * (1 + preReturn) + contribHsa;
      bCash = bCash * (1 + cashReturn);

      yearlyData.push({
        year,
        age,
        phase: "accumulation",
        spending: 0,
        partTime: 0,
        ss: 0,
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
        total: Math.round(bCash + bTaxable + b401k + bTradIra + bRoth + bHsa),
      });
      continue;
    }

    // Retirement year
    const healthcare = age < 65 ? healthcarePre65 : healthcarePost65;
    const spending = Math.round((baseExpenses + healthcare) * inflMult);
    const ptIncome =
      age < retirementAge + partTimeYears
        ? Math.round(partTimeIncome * inflMult)
        : 0;
    const ssGross = age >= ssAge ? Math.round(ssIncome * inflMult) : 0;
    const netNeed = Math.max(0, spending - ptIncome - ssGross);

    let wCash = 0,
      wTaxable = 0,
      w401k = 0,
      wIra = 0,
      wRoth = 0;
    let conversion = 0;
    let strategy = "";

    if (age < 60) {
      wCash = Math.min(netNeed, bCash);
      let rem = netNeed - wCash;
      if (rem > 0) {
        wTaxable = Math.min(rem, bTaxable);
        rem -= wTaxable;
      }
      if (rem > 0) {
        w401k = Math.min(rem, b401k);
      }
      const target = Math.round(conversionBridge * inflMult);
      conversion = Math.max(0, Math.min(target, b401k - w401k));
      strategy = `Cash → Taxable → 401k (R55) | Convert $${Math.round(
        conversionBridge / 1000,
      )}K`;
    } else if (age < 65) {
      wTaxable = Math.min(netNeed, bTaxable);
      let rem = netNeed - wTaxable;
      if (rem > 0) {
        wCash = Math.min(rem, bCash);
        rem -= wCash;
      }
      if (rem > 0) {
        w401k = Math.min(rem, b401k);
      }
      const target = Math.round(conversionMid * inflMult);
      conversion = Math.max(0, Math.min(target, b401k - w401k));
      strategy = `Taxable → Cash → 401k | Convert $${Math.round(
        conversionMid / 1000,
      )}K`;
    } else if (age < ssAge) {
      wTaxable = Math.min(netNeed, bTaxable);
      let rem = netNeed - wTaxable;
      if (rem > 0) {
        w401k = Math.min(rem, b401k);
        rem -= w401k;
      }
      if (rem > 0) {
        wIra = Math.min(rem, bTradIra);
      }
      const target = Math.round(conversionFinal * inflMult);
      conversion = Math.max(0, Math.min(target, b401k - w401k));
      strategy = `Taxable → 401k | Final convert $${Math.round(
        conversionFinal / 1000,
      )}K`;
    } else {
      // SS flowing — prioritize 401k/IRA, preserve Roth
      if (b401k > 0) {
        w401k = Math.min(netNeed, b401k);
        let rem = netNeed - w401k;
        if (rem > 0 && bTradIra > 0) {
          wIra = Math.min(rem, bTradIra);
          rem -= wIra;
        }
        if (rem > 0 && bTaxable > 0) {
          wTaxable = Math.min(rem, bTaxable);
          rem -= wTaxable;
        }
        if (rem > 0) {
          wRoth = Math.min(rem, bRoth);
        }
      } else {
        if (bTradIra > 0) {
          wIra = Math.min(netNeed, bTradIra);
        }
        let rem = netNeed - wIra;
        if (rem > 0 && bTaxable > 0) {
          wTaxable = Math.min(rem, bTaxable);
          rem -= wTaxable;
        }
        if (rem > 0) {
          wRoth = Math.min(rem, bRoth);
        }
      }
      strategy = "SS + 401k/IRA (Roth preserved)";
    }

    // Tax calculation
    const ltcgAmt = wTaxable * 0.6;
    const ordIncome =
      ptIncome + ssGross * 0.85 + w401k + wIra + conversion;
    const tax = Math.round(totalTax(ordIncome, ltcgAmt, year));

    // Gross up withdrawal to cover taxes
    if (age < 60) {
      wCash = Math.min(wCash + tax, bCash);
    } else if (age < 65) {
      wTaxable = Math.min(wTaxable + tax, bTaxable);
    } else if (age < ssAge) {
      wTaxable = Math.min(wTaxable + tax * 0.5, bTaxable);
      w401k = Math.min(w401k + tax * 0.5, Math.max(0, b401k - conversion));
    } else {
      w401k = Math.min(w401k + tax, b401k);
    }

    // Execute withdrawals
    bCash = Math.max(0, bCash - wCash);
    bTaxable = Math.max(0, bTaxable - wTaxable);
    b401k = Math.max(0, b401k - w401k - conversion);
    bRoth = bRoth + conversion;
    bTradIra = Math.max(0, bTradIra - wIra);
    bRoth = Math.max(0, bRoth - wRoth);

    // Grow balances
    bCash *= 1 + 0.03;
    bTaxable *= 1 + postReturn;
    b401k *= 1 + postReturn;
    bTradIra *= 1 + postReturn;
    bRoth *= 1 + postReturn;
    bHsa *= 1 + postReturn;

    totalTaxesPaid += tax;
    totalConverted += conversion;

    const total = bCash + bTaxable + b401k + bTradIra + bRoth + bHsa;
    const grossWithdrawal = wCash + wTaxable + w401k + wIra + wRoth;

    if (total < spending && !depleted) depleted = true;

    let phase = "bridge";
    if (age >= 60 && age < 65) phase = "mid";
    else if (age >= 65 && age < ssAge) phase = "medicare";
    else if (age >= ssAge) phase = "ss";

    yearlyData.push({
      year,
      age,
      phase,
      spending,
      partTime: ptIncome,
      ss: ssGross,
      netNeed,
      grossWithdrawal: Math.round(grossWithdrawal),
      // NEW: per-account withdrawals — where the money came from
      fromCash: Math.round(wCash),
      fromTaxable: Math.round(wTaxable),
      from401k: Math.round(w401k),
      fromIra: Math.round(wIra),
      fromRoth: Math.round(wRoth),
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
    });
  }

  const retirementData = yearlyData.find((d) => d.age === retirementAge);
  const endData = yearlyData[yearlyData.length - 1];
  const year1Data = retirementData;

  return {
    yearlyData,
    summary: {
      portfolioAtRetirement: retirementData ? retirementData.total : 0,
      portfolioAtEnd: endData.total,
      year1WithdrawalRate:
        year1Data && year1Data.total > 0
          ? year1Data.netNeed / year1Data.total
          : 0,
      year1Spending: year1Data ? year1Data.spending : 0,
      totalTaxesPaid: Math.round(totalTaxesPaid),
      totalConverted: Math.round(totalConverted),
      depleted,
      currentTotal:
        inputs.balanceCash +
        inputs.balanceTaxable +
        inputs.balance401k +
        inputs.balanceTradIra +
        inputs.balanceRoth +
        inputs.balanceHsa,
    },
  };
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

function NumberInput({ label, value, onChange, prefix, suffix, step = 1, hint }) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium text-slate-600 mb-1">
        {label}
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

function PctInput({ label, value, onChange, hint }) {
  const displayVal = Math.round(value * 10000) / 100;
  return (
    <NumberInput
      label={label}
      value={displayVal}
      onChange={(v) => onChange(v / 100)}
      suffix="%"
      step={0.1}
      hint={hint}
    />
  );
}

function Section({ title, children, badge }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-slate-200 last:border-b-0 py-3">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex justify-between items-center text-left group"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
            {title}
          </h3>
          {badge && (
            <span className="text-xs text-indigo-600 font-medium bg-indigo-50 px-2 py-0.5 rounded">
              {badge}
            </span>
          )}
        </div>
        <span className="text-slate-400 text-lg group-hover:text-slate-600 transition">
          {open ? "−" : "+"}
        </span>
      </button>
      {open && <div className="mt-3">{children}</div>}
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
// MAIN COMPONENT
// ============================================================

const DEFAULT_INPUTS = {
  currentAge: 45,
  retirementAge: 60,
  planThroughAge: 95,
  balanceCash: 100000,
  balanceTaxable: 300000,
  balance401k: 800000,
  balanceTradIra: 50000,
  balanceRoth: 100000,
  balanceHsa: 25000,
  preReturn: 0.07,
  postReturn: 0.06,
  cashReturn: 0.04,
  inflation: 0.03,
  contrib401k: 23500,
  contribMatch: 3000,
  contribHsa: 4150,
  baseExpenses: 50000,
  healthcarePre65: 15000,
  healthcarePost65: 6000,
  partTimeIncome: 15000,
  partTimeYears: 5,
  ssIncome: 25000,
  ssAge: 67,
  conversionBridge: 40000,
  conversionMid: 50000,
  conversionFinal: 60000,
};

export default function RetirementPlanner() {
  const [inputs, setInputs] = useState(DEFAULT_INPUTS);
  const results = useMemo(() => simulate(inputs), [inputs]);

  const update = (key) => (val) =>
    setInputs((prev) => ({ ...prev, [key]: val }));

  const reset = () => setInputs(DEFAULT_INPUTS);

  const chartData = results.yearlyData.map((d) => ({
    age: d.age,
    Cash: d.cash,
    Taxable: d.taxable,
    "401k": d.k401,
    "Trad IRA": d.tradIra,
    Roth: d.roth,
    HSA: d.hsa,
    "Annual Spending": d.phase === "accumulation" ? null : d.spending,
  }));

  const flowData = results.yearlyData
    .filter((d) => d.phase !== "accumulation")
    .map((d) => ({
      age: d.age,
      "Part-Time": d.partTime,
      "Social Security": d.ss,
      Withdrawals: d.grossWithdrawal,
      Spending: d.spending,
    }));

  const s = results.summary;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
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
        <div className="flex justify-between items-center max-w-7xl mx-auto">
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              Retirement Planner
            </h1>
            <p className="text-indigo-200 text-sm mt-0.5">
              Tax-aware projection • Roth conversion strategy • NY State
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => window.print()}
              className="text-xs bg-emerald-500 hover:bg-emerald-400 text-white px-3 py-1.5 rounded border border-emerald-400 transition font-medium"
            >
              Save as PDF
            </button>
            <button
              onClick={reset}
              className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded border border-white/20 transition"
            >
              Reset to defaults
            </button>
          </div>
        </div>
      </header>

      {/* Metrics strip */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 print:px-0 print:py-2 print-avoid-break">
        <div className="max-w-7xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard
            label={`Portfolio at ${inputs.retirementAge}`}
            value={fmtMoney(s.portfolioAtRetirement)}
            sublabel={`Up from ${fmtMoney(s.currentTotal)} today`}
            tone="good"
          />
          <MetricCard
            label={`Portfolio at ${inputs.planThroughAge}`}
            value={fmtMoney(s.portfolioAtEnd)}
            sublabel={
              s.portfolioAtEnd > 0 ? "Plan stays solvent" : "Funds depleted"
            }
            tone={s.portfolioAtEnd > 0 ? "good" : "bad"}
          />
          <MetricCard
            label="Year 1 Withdrawal Rate"
            value={fmtPct(s.year1WithdrawalRate)}
            sublabel={
              s.year1WithdrawalRate < 0.04
                ? "Below 4% — sustainable"
                : "Above 4% — monitor closely"
            }
            tone={s.year1WithdrawalRate < 0.04 ? "good" : "warn"}
          />
          <MetricCard
            label="Total Roth Converted"
            value={fmtMoney(s.totalConverted)}
            sublabel={`Lifetime taxes: ${fmtMoney(s.totalTaxesPaid)}`}
          />
        </div>
      </div>

      {/* Main layout */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 print:p-0 print:gap-2">
        {/* Inputs sidebar */}
        <aside className="lg:col-span-4 xl:col-span-3 print:hidden">
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
            <h2 className="text-base font-bold text-slate-900 mb-1">
              Your Inputs
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Numbers update everything live.
            </p>

            <Section title="Timing">
              <NumberInput
                label="Current Age"
                value={inputs.currentAge}
                onChange={update("currentAge")}
              />
              <NumberInput
                label="Retirement Age"
                value={inputs.retirementAge}
                onChange={update("retirementAge")}
                hint="Target age to leave corporate work"
              />
              <NumberInput
                label="Plan Through Age"
                value={inputs.planThroughAge}
                onChange={update("planThroughAge")}
              />
            </Section>

            <Section title="Current Balances">
              <NumberInput
                label="Cash / HYSA"
                value={inputs.balanceCash}
                onChange={update("balanceCash")}
                prefix="$"
                step={1000}
              />
              <NumberInput
                label="Taxable Brokerage"
                value={inputs.balanceTaxable}
                onChange={update("balanceTaxable")}
                prefix="$"
                step={1000}
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
              />
            </Section>

            <Section title="Returns & Inflation">
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
              />
              <PctInput
                label="Inflation Rate"
                value={inputs.inflation}
                onChange={update("inflation")}
              />
            </Section>

            <Section title="Contributions (Pre-Retirement)">
              <NumberInput
                label="401k Employee"
                value={inputs.contrib401k}
                onChange={update("contrib401k")}
                prefix="$"
                step={500}
              />
              <NumberInput
                label="Employer Match"
                value={inputs.contribMatch}
                onChange={update("contribMatch")}
                prefix="$"
                step={500}
              />
              <NumberInput
                label="HSA Contribution"
                value={inputs.contribHsa}
                onChange={update("contribHsa")}
                prefix="$"
                step={500}
              />
            </Section>

            <Section title="Spending (in retirement year 1)">
              <NumberInput
                label="Base Lifestyle Expenses"
                value={inputs.baseExpenses}
                onChange={update("baseExpenses")}
                prefix="$"
                step={1000}
                hint="Non-healthcare annual spending"
              />
              <NumberInput
                label="Healthcare (55-64)"
                value={inputs.healthcarePre65}
                onChange={update("healthcarePre65")}
                prefix="$"
                step={1000}
                hint="ACA marketplace before Medicare"
              />
              <NumberInput
                label="Healthcare (65+)"
                value={inputs.healthcarePost65}
                onChange={update("healthcarePost65")}
                prefix="$"
                step={500}
                hint="Medicare + Medigap"
              />
            </Section>

            <Section title="Income">
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
                label="Social Security / Year"
                value={inputs.ssIncome}
                onChange={update("ssIncome")}
                prefix="$"
                step={1000}
                hint="In today's dollars; verify at ssa.gov"
              />
              <NumberInput
                label="Age to Claim SS"
                value={inputs.ssAge}
                onChange={update("ssAge")}
                hint="67 = full benefit"
              />
            </Section>

            <Section title="Roth Conversions" badge="Strategy">
              <NumberInput
                label="Ages 55-59 / Year"
                value={inputs.conversionBridge}
                onChange={update("conversionBridge")}
                prefix="$"
                step={5000}
                hint="Fill 12% bracket"
              />
              <NumberInput
                label="Ages 60-64 / Year"
                value={inputs.conversionMid}
                onChange={update("conversionMid")}
                prefix="$"
                step={5000}
              />
              <NumberInput
                label="Ages 65 to SS / Year"
                value={inputs.conversionFinal}
                onChange={update("conversionFinal")}
                prefix="$"
                step={5000}
                hint="Last chance before SS"
              />
            </Section>
          </div>
        </aside>

        {/* Results area */}
        <main className="lg:col-span-8 xl:col-span-9 print:col-span-12 space-y-6 print:space-y-3">
          {/* Portfolio composition chart */}
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm print:shadow-none print:border-slate-300 print-avoid-break">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Portfolio Composition Over Time
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Watch how each account evolves through accumulation and
                  drawdown. Notice Roth growing via conversions.
                </p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={360}>
              <ComposedChart data={chartData}>
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
                  tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                />
                <Tooltip
                  formatter={(v) => fmtMoneyFull(v)}
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine
                  x={inputs.retirementAge}
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
                  x={inputs.ssAge}
                  stroke="#6366f1"
                  strokeDasharray="3 3"
                  label={{
                    value: "SS",
                    position: "top",
                    fill: "#6366f1",
                    fontSize: 11,
                  }}
                />
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
                  dataKey="401k"
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
                Where each year's spending comes from. Withdrawals fill the gap
                between income and spending.
              </p>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={flowData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="age"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                />
                <YAxis
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                />
                <Tooltip
                  formatter={(v) => fmtMoneyFull(v)}
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey="Spending"
                  stroke="#ef4444"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="Withdrawals"
                  stroke="#7c3aed"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="Social Security"
                  stroke="#6366f1"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="Part-Time"
                  stroke="#059669"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Year-by-year table */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden print:shadow-none print:border-slate-300 print-page-break">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">
                Year-by-Year Detail
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Reading each row: <span className="text-emerald-700 font-medium">income + withdrawals</span> = cash to cover <span className="text-slate-700 font-medium">spending + tax</span>. <span className="text-indigo-700 font-medium">Roth conversions</span> are separate tax-planning moves.
              </p>
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
                <span className="text-slate-700">Roth conversion (401k → Roth)</span>
              </span>
            </div>

            <div className="overflow-auto max-h-[600px] print:max-h-none print:overflow-visible">
              <table className="w-full text-xs">
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
                      colSpan={2}
                    >
                      Income
                    </th>
                    <th
                      className="px-2 py-2 text-center font-semibold text-sky-700 bg-sky-50 border-r border-slate-200"
                      colSpan={5}
                    >
                      Withdrawn From
                    </th>
                    <th
                      className="px-2 py-2 text-center font-semibold text-indigo-700 bg-indigo-50 border-r border-slate-200"
                      colSpan={1}
                    >
                      Roth
                    </th>
                    <th className="px-2 py-2 text-center font-semibold text-slate-700 bg-slate-200">
                      End Bal
                    </th>
                  </tr>
                  {/* Column headers */}
                  <tr className="border-b-2 border-slate-300 bg-slate-50">
                    <th className="px-3 py-2 text-left font-semibold text-slate-700">
                      Age
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
                    <th className="px-3 py-2 text-right font-semibold text-sky-700 bg-sky-50">
                      Cash
                    </th>
                    <th className="px-3 py-2 text-right font-semibold text-sky-700 bg-sky-50">
                      Taxable
                    </th>
                    <th className="px-3 py-2 text-right font-semibold text-sky-700 bg-sky-50">
                      401k
                    </th>
                    <th className="px-3 py-2 text-right font-semibold text-sky-700 bg-sky-50">
                      IRA
                    </th>
                    <th className="px-3 py-2 text-right font-semibold text-sky-700 bg-sky-50 border-r border-slate-200">
                      Roth
                    </th>
                    <th className="px-3 py-2 text-right font-semibold text-indigo-700 bg-indigo-50 border-r border-slate-200">
                      Convert
                    </th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700 bg-slate-200">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {results.yearlyData
                    .filter((d) => d.phase !== "accumulation")
                    .map((d) => {
                      return (
                        <tr
                          key={d.year}
                          className="border-b border-slate-100 hover:bg-slate-50"
                        >
                          <td className="px-3 py-1.5 font-semibold">
                            {d.age}
                          </td>
                          <td className="px-3 py-1.5">
                            <PhasePill phase={d.phase} />
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
                              d.from401k > 0 ? "text-sky-700 font-medium" : "text-slate-300"
                            }`}
                          >
                            {d.from401k > 0 ? fmtMoney(d.from401k) : "—"}
                          </td>
                          <td
                            className={`px-3 py-1.5 text-right ${
                              d.fromIra > 0 ? "text-sky-700 font-medium" : "text-slate-300"
                            }`}
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
                              d.conversion > 0
                                ? "text-indigo-700 font-medium"
                                : "text-slate-300"
                            }`}
                          >
                            {d.conversion > 0
                              ? fmtMoney(d.conversion)
                              : "—"}
                          </td>
                          <td className="px-3 py-1.5 text-right font-semibold bg-slate-50">
                            {fmtMoney(d.total)}
                          </td>
                        </tr>
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
                  <span className="text-indigo-700 font-medium">Roth Conversion</span> moves money from 401k to Roth (taxable event, no cash out).
                </p>
                <p>
                  <span className="font-medium text-slate-900">By age 67:</span> Spending is covered by{" "}
                  <span className="text-emerald-700 font-medium">Social Security</span> +{" "}
                  <span className="text-sky-700 font-medium">401k withdrawals</span>. Roth stays untouched to grow tax-free.
                </p>
                <p className="italic text-slate-500 mt-2">
                  The "End Bal" column shows your total portfolio at year's end, after withdrawals, conversions, and growth.
                </p>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-xs text-amber-900 print-avoid-break">
            <p className="font-semibold mb-2">Model Assumptions & Caveats</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>
                Tax: MFJ federal brackets + NY State, inflation-adjusted from
                2024
              </li>
              <li>
                Taxable brokerage treated as 40% basis / 60% long-term capital
                gains
              </li>
              <li>Social Security: 85% taxable (max — due to other income)</li>
              <li>
                Roth conversions assumed paid from same bucket being tapped
              </li>
              <li>
                Does not model: IRMAA surcharges, ACA subsidy cliff, TCJA
                sunset, RMDs at 73, state tax changes, market sequence risk
              </li>
              <li>
                Not financial advice — consult a fee-only fiduciary & CPA
              </li>
            </ul>
          </div>
        </main>
      </div>
    </div>
  );
}
