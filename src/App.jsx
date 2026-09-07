import FinancialDetails from "./FinancialDetails.jsx";
import { NumericField, WorkspaceNav, ScenarioDialog, SettingsWorkspace, BaselineControls, ExploreDetails, YearInspector, CompactMetric } from './ui/PlannerWorkspace.jsx';
import { captureBaseline, baselineSeries, compareBaseline } from './ui/planComparison.js';
import {
  CASH_STRATEGY_OPTIONS,
  DEFAULT_INPUTS,
  PROJECTION_START_YEAR,
  bestCashStrategyAlternative,
  buildAppliedInputChanges,
  compareCashStrategies,
  computeShortfallInfo,
  defaultRmdStartAge,
  diagnoseSuccessRate,
  fmtMoney,
  fmtMoneyFull,
  fmtPct,
  generatePlanNarrative,
  getContributionLimits,
  getDisplayInputs,
  isCoupleMode,
  materialYearUnmetThreshold,
  normalizeCoupleInputs,
  normalizeInputs,
  parseSettingsText,
  resolveInheritedFinalDistributionYear,
  runMonteCarlo,
  runSelfTests,
  simulatePlan,
  solveMaxSustainableSpending
} from "./finance/engine.js";
import { Fragment, useState, useMemo, useEffect, useRef, useId } from "react";
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

const TERM_HELP = {
  aca:
    "Affordable Care Act marketplace health insurance. Subsidies can lower pre-Medicare premiums, but they depend heavily on MAGI and household size.",
  bco:
    "Beneficiary Continuation Option. Offered on inherited annuity/retirement contracts (e.g. EQUI-VEST): the beneficiary keeps the account invested in inherited form instead of cashing out. Because the account stays in beneficiary form, withdrawals at ANY age are exempt from the 10% early-withdrawal penalty (the IRS death exception) — but the taxable portion is still ordinary income, and required payouts apply (life-expectancy payments for eligible beneficiaries, or full depletion within 10 years). Caution: a surviving spouse who instead elects spousal continuation (treating the account as their own) gives up the penalty exemption before 59½.",
  bcoContract:
    "Contract-specific BCO terms are separate from federal beneficiary rules. An Equitable EQUI-VEST Series 201 endorsement may waive withdrawal charges and require final liquidation at the deceased owner's stated age, but an age-based deadline is not universal and must be entered from the actual endorsement.",
  flexibleSpending:
    "A Monte Carlo assumption that cuts discretionary spending by 10% after a year when the portfolio falls more than 15%. This models retirees tightening spending after bad markets.",
  fra:
    "Full Retirement Age for Social Security, derived from your birth year: 66 for those born 1943-1954, rising by 2 months per year to 67 for 1960 and later. Benefits are reduced for claims before FRA and earn 8%/year delayed credits (no cap) up to age 70.",
  hsa:
    "Health Savings Account. Tax-advantaged medical account; withdrawals for qualified medical costs are tax-free.",
  hysa:
    "High-yield savings account. This app treats Cash / HYSA as low-risk cash earning the Cash / HYSA Return assumption.",
  irmaa:
    "Income-Related Monthly Adjustment Amount. Extra Medicare Part B and Part D premiums for higher-income households.",
  magi:
    "Modified Adjusted Gross Income. A tax-income measure used for ACA subsidies, IRMAA, and other thresholds. Roth conversions increase MAGI.",
  mfj:
    "Married Filing Jointly. Couple mode always uses married-joint brackets and thresholds; Individual mode uses your selected filing status (Single or Married joint).",
  niit:
    "Net Investment Income Tax. A 3.8% surtax on investment income above the MAGI threshold: $250K married filing jointly, $200K single.",
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
      role="button"
      tabIndex={0}
      aria-label={text}
      aria-expanded={isOpen}
      onFocus={() => setIsOpen(true)}
      onBlur={() => setIsOpen(false)}
      onKeyDown={event => { if (["Enter", " ", "Escape"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); setIsOpen(event.key === "Escape" ? false : !isOpen); } }}
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
  const id = useId();
  return (
    <div className="mb-3">
      <label htmlFor={id} className="block text-xs font-medium text-slate-600 mb-1">
        {info ? <TermLabel info={info}>{label}</TermLabel> : label}
      </label>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
            {prefix}
          </span>
        )}
        <NumericField
          id={id}
          aria-describedby={hint ? `${id}-hint` : undefined}
          value={value}
          onValue={onChange}
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
      {hint && <p id={`${id}-hint`} className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

function TextInput({ label, value, onChange, hint }) {
  const id = useId();
  return (
    <div className="mb-3">
      <label htmlFor={id} className="block text-xs font-medium text-slate-600 mb-1">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        type="text"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      {hint && <p id={`${id}-hint`} className="text-xs text-slate-500 mt-1">{hint}</p>}
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

function SelectInput({ label, value, onChange, options, hint, info }) {
  const id = useId();
  return (
    <div className="mb-3">
      <label htmlFor={id} className="block text-xs font-medium text-slate-600 mb-1">
        {info ? <TermLabel info={info}>{label}</TermLabel> : label}
      </label>
      <select
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-slate-300 bg-white text-slate-900 text-sm py-1.5 px-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <p id={`${id}-hint`} className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
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
  const sectionId = useId();
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
    <section id={sectionId} data-settings-title={title} className={`settings-section ${styles.wrapper}`}>
      <button
        onClick={() => setOpen(!open)}
        data-section-toggle
        aria-expanded={open}
        aria-controls={`${sectionId}-body`}
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
      <div id={`${sectionId}-body`} hidden={!open} className={`section-body ${styles.body}`}>{children}</div>
    </section>
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
  calculationValid = true,
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
            {maxSustainableSpending == null && calculationValid && (
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
// SettingsImport — modal dialog: paste an exported settings block to fill in
// every matching field at once. Opened from the "Load from text…" toolbar
// button so it's discoverable regardless of the active tab or scroll position.
// ============================================================
function SettingsImport({ open, onClose, onApply }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);

  // Reset the form each time the dialog is opened so stale text/results from a
  // previous session don't linger.
  useEffect(() => {
    if (open) {
      setText("");
      setResult(null);
    }
  }, [open]);

  const importRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const controls = [...importRef.current.querySelectorAll('button:not(:disabled), textarea, input, select')];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [open, onClose]);
  if (!open) return null;

  const handleLoad = () => {
    const parsed = parseSettingsText(text);
    if (parsed.isCouple && !parsed.completeScenario) {
      setResult({ kind: "couple" });
      return;
    }
    if (parsed.applied.length === 0) {
      setResult({ kind: "empty", skipped: parsed.skipped });
      return;
    }
    onApply(parsed.updates);
    setResult({
      kind: "ok",
      completeScenario: parsed.completeScenario,
      applied: parsed.applied,
      skipped: parsed.skipped,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:p-8 print:hidden"
      onClick={onClose}
      ref={importRef}
      role="dialog"
      aria-modal="true"
      aria-label="Load settings from text"
    >
      <div
        className="w-full max-w-2xl my-auto bg-white rounded-lg shadow-xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-800">
            Load Settings from Text
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-700 text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="p-5">
          <p className="text-xs text-slate-500 mb-2">
            Paste a settings block in the same format as “Current Settings
            (Copy/Paste)” at the bottom of the plan — section headings like{" "}
            <code className="bg-slate-100 px-1 rounded">## Current Balances</code>{" "}
            and one{" "}
            <code className="bg-slate-100 px-1 rounded">Label: value</code> per
            line. Unknown lines are ignored. This replaces the matching values
            in your current plan; it does not delete any saved scenarios.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
            placeholder={"# Retirement Planner Settings\n\n## Timing\nFiling Status: Single\nCurrent Age: 50\nRetirement Age: 51\n\n## Current Balances\nCash / HYSA: $1,400,000\n401k / 403b: $1,258,000\n..."}
            className="w-full h-64 text-xs font-mono p-2 border border-slate-300 rounded bg-slate-50 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <div className="flex items-center gap-3 mt-3">
            <button
              type="button"
              onClick={handleLoad}
              disabled={!text.trim()}
              className="text-xs bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded font-medium transition"
            >
              Load Settings
            </button>
            {text.trim() && (
              <button
                type="button"
                onClick={() => {
                  setText("");
                  setResult(null);
                }}
                className="text-xs text-slate-500 hover:text-slate-700"
              >
                Clear
              </button>
            )}
            <span className="flex-1" />
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded border border-slate-300 transition"
            >
              {result?.kind === "ok" ? "Done" : "Cancel"}
            </button>
          </div>

          {result?.kind === "couple" && (
            <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              This looks like a{" "}
              <span className="font-semibold">Married Couple</span> settings
              block. Text import currently supports individual-mode plans only.
              Switch the plan to Individual, or load couple plans from a saved
              scenario instead.
            </div>
          )}
          {result?.kind === "empty" && (
            <div className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
              No recognized settings were found. Check that each line reads
              <span className="font-mono"> Label: value</span> using the labels
              from the “Current Settings (Copy/Paste)” block.
            </div>
          )}
          {result?.kind === "ok" && (
            <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              <p className="font-semibold">
                ✓ {result.completeScenario ? 'Loaded the complete scenario' : `Applied ${result.applied.length} setting${result.applied.length === 1 ? '' : 's'}`}. The plan has been
                updated — close this dialog to see the results.
              </p>
              {result.skipped.length > 0 && (
                <p className="mt-1 text-emerald-800">
                  Ignored {result.skipped.length} unrecognized line
                  {result.skipped.length === 1 ? "" : "s"}:{" "}
                  {result.skipped
                    .slice(0, 6)
                    .map((s) => s.label)
                    .join(", ")}
                  {result.skipped.length > 6 ? "…" : ""}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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
  const inheritedExportPlanType = exportInputs.inheritedPlanType ||
    (exportInputs.inheritedTaxType === "nonqualified"
      ? "nonqualifiedAnnuity"
      : "qualifiedOther");
  const inheritedExportChargePolicy =
    exportInputs.inheritedWithdrawalChargePolicy || "unknown";
  const inheritedExportDeadline = resolveInheritedFinalDistributionYear({
    payoutRule: exportInputs.inheritedPayoutRule || "lifeExpectancy",
    deathYear: exportInputs.inheritedDeathYear || PROJECTION_START_YEAR,
    deceasedBirthYear: exportInputs.inheritedDeceasedBirthYear || 1965,
    contractMode: exportInputs.inheritedContractFinalDistributionMode || "none",
    contractAge: exportInputs.inheritedContractFinalDistributionAge || 72,
    contractYear: exportInputs.inheritedContractFinalDistributionYear || 0,
  });
  const inheritedExportPlanLabel = {
    "403bTsa": "403(b) TSA / public-school plan",
    ira: "Inherited IRA",
    qualifiedOther: "Other qualified retirement plan",
    nonqualifiedAnnuity: "Nonqualified annuity",
  }[inheritedExportPlanType] || "Other qualified retirement plan";
  const inheritedExportChargeLabel = {
    bcoNoCharge: "BCO endorsement: no withdrawal charge",
    standardContract: "Standard contract schedule - not modeled",
    unknown: "Unknown - verify contract",
  }[inheritedExportChargePolicy] || "Unknown - verify contract";
  const inheritedExportFinalRuleLabel = {
    none: "No contract-specific final deadline",
    ownerAge: `Deceased owner's age ${fmtNum(exportInputs.inheritedContractFinalDistributionAge || 72)}`,
    explicitYear: `Specific calendar year ${fmtNum(exportInputs.inheritedContractFinalDistributionYear || 0)}`,
  }[exportInputs.inheritedContractFinalDistributionMode || "none"] ||
    "No contract-specific final deadline";
  const inheritedExportOwnerRmdLabel = {
    auto: "Auto (infer from years)",
    beforeRbd: "Died before required beginning date",
    onOrAfterRbd: "Died on or after required beginning date",
  }[exportInputs.inheritedOwnerRmdStatus || "auto"] || "Auto (infer from years)";
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
          ["Roth Contributions to Date", fmtMoney(person.rothBasis || 0)],
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
          ["Annual Salary (Gross)", fmtMoney(person.salaryIncome || 0)],
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
        [
          "Filing Status",
          exportInputs.filingStatus === "mfj"
            ? "Married filing jointly"
            : "Single",
        ],
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
        ["Roth Contributions to Date", fmtMoney(exportInputs.rothBasis || 0)],
        ["HSA", fmtMoney(exportInputs.balanceHsa)],
        ["Credit Card Debt", fmtMoney(exportInputs.creditCardDebt)],
      ],
    },
    ...((exportInputs.balanceInherited || 0) > 0
      ? [
          {
            title: "Inherited (BCO)",
            rows: [
              ["Balance", fmtMoney(exportInputs.balanceInherited)],
              [
                "Inherited Plan Type",
                inheritedExportPlanLabel,
              ],
              [
                "Contract / Product",
                exportInputs.inheritedContractLabel || "Not entered",
              ],
              ["Withdrawal-Charge Treatment", inheritedExportChargeLabel],
              [
                "Partial Withdrawal Minimum",
                fmtMoney(exportInputs.inheritedPartialWithdrawalMinimum || 0),
              ],
              ...(inheritedExportPlanType === "nonqualifiedAnnuity"
                ? [["Cost Basis", fmtMoney(exportInputs.inheritedBasis || 0)]]
                : []),
              [
                "Payout Rule",
                exportInputs.inheritedPayoutRule === "tenYear"
                  ? "10-year rule"
                  : "Life expectancy (stretch)",
              ],
              [
                "Relationship to Owner",
                exportInputs.inheritedRelationship === "nonSpouse"
                  ? "Other beneficiary"
                  : "Surviving spouse",
              ],
              ["Year of Owner's Death", fmtNum(exportInputs.inheritedDeathYear)],
              [
                "Owner's Birth Year",
                fmtNum(exportInputs.inheritedDeceasedBirthYear),
              ],
              ["Owner RMD Status", inheritedExportOwnerRmdLabel],
              ["Contract Final Distribution Rule", inheritedExportFinalRuleLabel],
              [
                "Contract Final Distribution Year",
                fmtNum(inheritedExportDeadline.contractDeadline),
              ],
              [
                "Effective Final Distribution Year",
                fmtNum(inheritedExportDeadline.effectiveDeadline),
              ],
              [
                "Contract Source Note",
                exportInputs.inheritedContractSourceNote || "Not entered",
              ],
            ],
          },
        ]
      : []),
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
        ["Annual Salary (Gross)", fmtMoney(exportInputs.salaryIncome || 0)],
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
    lines.push(`Scenario data v2: ${JSON.stringify(normalizeInputs(sourceInputs))}`);
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
        aria-expanded={open}
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
        <span className="text-slate-400 text-lg print:hidden">{open ? "−" : "+"}</span>
      </button>
      {/* Body is always rendered so "Save as PDF" (window.print) captures the
          full settings table even while the section is collapsed on screen:
          `hidden` hides it when closed, `print:block` re-shows it in print. */}
      <div
        className={`border-t border-slate-200 p-4 ${open ? "" : "hidden print:block"}`}
      >
        <div className="flex justify-end mb-3 print:hidden">
          <button
            type="button"
            onClick={handleCopy}
            className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded font-medium transition"
          >
            {copied ? "✓ Copied!" : "Copy All as Text"}
          </button>
        </div>
        {copyError && (
          <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 print:hidden">
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
            className="mt-4 print:hidden"
            open={plainTextOpen}
            onToggle={(event) => setPlainTextOpen(event.currentTarget.open)}
          >
            <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-700">
              Show as plain text (for email / chat / manual copy)
            </summary>
            <textarea
              id="settings-export-textarea"
              aria-label="Complete scenario settings export"
              readOnly
              value={buildPlainText()}
              className="mt-2 w-full h-64 text-xs font-mono p-2 border border-slate-300 rounded bg-slate-50 text-slate-800"
              onClick={(e) => e.target.select()}
            />
          </details>
      </div>
    </div>
  );
}

function MiniStackedBar({ row }) {
  if (!row.total || row.total === 0) return <span className="text-slate-300">—</span>;
  const segments = [
    { value: row.cash, color: "#94a3b8", name: "Cash" },
    { value: row.taxable, color: "#7dd3fc", name: "Taxable" },
    { value: row.inherited, color: "#bef264", name: "Inherited (BCO)" },
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

// Small color chip matching the series color used in the chart + legend.
function SeriesSwatch({ color }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm border border-black/10"
      style={{ background: color }}
      aria-hidden="true"
    />
  );
}

// Chart hover tooltip, shared by the portfolio-composition and cash-flow
// charts. Rendered as a table with a color swatch per row (matching the
// legend), grouped into income vs. account withdrawals on the cash-flow
// chart, with subtotals and the spending+tax "Need" breakdown.
function CashFlowTooltip({ active, payload, isCouple, showNeedBreakdown = false }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const visiblePayload = payload.filter(
    (item) => item.value != null && item.value !== 0,
  );
  const seriesColor = (item) => item.color || item.fill || "#64748b";
  const NEED_NAME = "Need (Spending + Tax)";
  const INCOME_NAMES = new Set(["Part-Time", "Social Security", "Pension"]);

  const incomeItems = [];
  const accountItems = [];
  const spendingItems = []; // "Annual Spending" line on the composition chart
  let needItem = null;
  for (const item of visiblePayload) {
    const name = String(item.name ?? item.dataKey);
    if (name === NEED_NAME) needItem = item;
    else if (name === "Annual Spending") spendingItems.push(item);
    else if (INCOME_NAMES.has(name)) incomeItems.push(item);
    else accountItems.push(item);
  }
  const sum = (items) => items.reduce((acc, i) => acc + (i.value || 0), 0);

  const seriesRow = (item) => (
    <tr key={item.dataKey}>
      <td className="py-0.5 pr-4">
        <span className="inline-flex items-center gap-1.5 text-slate-600">
          <SeriesSwatch color={seriesColor(item)} />
          {item.name || item.dataKey}
        </span>
      </td>
      <td className="py-0.5 text-right font-mono tabular-nums text-slate-900">
        {fmtMoneyFull(item.value)}
      </td>
    </tr>
  );
  const groupHeader = (label) => (
    <tr>
      <td
        colSpan={2}
        className="pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400"
      >
        {label}
      </td>
    </tr>
  );
  const subtotalRow = (label, value, keySuffix) => (
    <tr key={`subtotal-${keySuffix}`} className="border-t border-slate-200">
      <td className="py-0.5 pr-4 pl-4 text-slate-500">{label}</td>
      <td className="py-0.5 text-right font-mono tabular-nums font-semibold text-slate-900">
        {fmtMoneyFull(value)}
      </td>
    </tr>
  );

  return (
    <div className="max-w-sm rounded border border-slate-300 bg-white p-3 text-xs shadow-lg">
      <div className="mb-1.5 font-semibold text-slate-900">
        {formatYearAgeLabel(row, isCouple)}
      </div>
      <table className="w-full border-collapse text-xs">
        <tbody>
          {showNeedBreakdown ? (
            <>
              {incomeItems.length > 0 && groupHeader("Income")}
              {incomeItems.map(seriesRow)}
              {incomeItems.length > 1 &&
                subtotalRow("Income total", sum(incomeItems), "income")}
              {accountItems.length > 0 && groupHeader("Withdrawn from accounts")}
              {accountItems.map(seriesRow)}
              {accountItems.length > 1 &&
                subtotalRow("Withdrawals total", sum(accountItems), "accounts")}
            </>
          ) : (
            <>
              {accountItems.map(seriesRow)}
              {accountItems.length > 1 &&
                row.total != null &&
                subtotalRow("Total portfolio", row.total, "portfolio")}
              {[...incomeItems, ...spendingItems].map(seriesRow)}
            </>
          )}
        </tbody>
      </table>
      {showNeedBreakdown && row.spending > 0 && (
        <table className="mt-2 w-full border-collapse border-t border-slate-200 pt-2 text-xs">
          <tbody>
            <tr>
              <td className="pt-1.5 pr-4 pb-0.5">
                <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900">
                  <SeriesSwatch
                    color={needItem ? seriesColor(needItem) : "#ef4444"}
                  />
                  {NEED_NAME}
                </span>
              </td>
              <td className="pt-1.5 pb-0.5 text-right font-mono tabular-nums font-semibold text-slate-900">
                {fmtMoneyFull(row.spending + row.tax)}
              </td>
            </tr>
            <tr>
              <td className="py-0.5 pr-4 pl-4 text-slate-500">= Spending</td>
              <td className="py-0.5 text-right font-mono tabular-nums text-slate-900">
                {fmtMoneyFull(row.spending)}
              </td>
            </tr>
            <tr>
              <td className="py-0.5 pr-4 pl-4 text-slate-500">
                + Tax
                {row.earlyPenalty > 0
                  ? ` (incl. ${fmtMoneyFull(row.earlyPenalty)} penalty)`
                  : ""}
              </td>
              <td className="py-0.5 text-right font-mono tabular-nums text-slate-900">
                {fmtMoneyFull(row.tax)}
              </td>
            </tr>
            {row.conversion > 0 && (
              <tr>
                <td className="py-0.5 pr-4 text-indigo-700">
                  <span className="inline-flex items-center gap-1.5">
                    <SeriesSwatch color="#6366f1" />
                    Roth conversion (taxed, not spending)
                  </span>
                </td>
                <td className="py-0.5 text-right font-mono tabular-nums text-indigo-700">
                  {fmtMoneyFull(row.conversion)}
                </td>
              </tr>
            )}
            {(row.surplusToCash || 0) > 0 && (
              <tr>
                <td className="py-0.5 pr-4 text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    <SeriesSwatch color="#64748b" />
                    Excess over need — saved to Cash
                  </span>
                </td>
                <td className="py-0.5 text-right font-mono tabular-nums text-slate-900">
                  {fmtMoneyFull(row.surplusToCash)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
  cashStrategyImpact = null,
}) {
  const earliestRetireAge = displayInputs.retirementAge;
  if (earliestRetireAge >= 59.5) return null;

  // Definitive cash-order comparison (same engine, all four orders).
  const activeStrategy = displayInputs.cashStrategy || "cashFirst";
  const strategyCurrent = cashStrategyImpact?.[activeStrategy];
  const strategyBest = cashStrategyImpact
    ? bestCashStrategyAlternative(cashStrategyImpact, activeStrategy)
    : null;
  const strategyBestLabel = strategyBest
    ? CASH_STRATEGY_OPTIONS.find((o) => o.value === strategyBest.value)?.label ||
      strategyBest.value
    : null;
  // Penalties exist but a zero-penalty withdrawal order is available: the
  // user has enough penalty-free money — the order alone causes the cost.
  const orderCausedPenalty =
    strategyBest != null && strategyBest.penaltyTotal <= 0;

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
  // Inherited (BCO) draws are penalty-free at any age (death exception), so
  // they count with the bridge-friendly sources, never the penalized ones.
  const fromInherited = sumAdj((d) => d.fromInherited || 0);
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
      name: "Inherited (BCO)",
      balance: displayInputs.balanceInherited,
      status:
        "No 10% penalty at ANY age — beneficiary distributions use the IRS death exception. The taxable portion is ordinary income, and required payouts continue on the beneficiary schedule. (Spousal continuation — retitling as your own — would give up this exemption before 59½.)",
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
            {fromInherited > 0 ? ", inherited BCO" : ""}
            {bridgeIncome > 0 ? ", plus part-time/pension income" : ""}) covers
            all {bridgeYearCount} bridge year{bridgeYearCount === 1 ? "" : "s"}{" "}
            without touching retirement accounts early.
          </span>
        ) : orderCausedPenalty ? (
          <span>
            <span className="font-semibold">
              You have enough penalty-free money to reach 59½ — but your
              selected withdrawal order doesn't use it that way.
            </span>{" "}
            The "{CASH_STRATEGY_OPTIONS.find((o) => o.value === activeStrategy)
              ?.label || activeStrategy}" setting sends{" "}
            {fmtMoney(penaltyDraws)} through retirement accounts before 59½,
            costing about {fmtMoney(totalPenalties)} in{" "}
            <em>avoidable</em> 10% penalties. Switching the Cash Withdrawal
            Strategy (All settings → Cash Strategy) to "{strategyBestLabel}"
            eliminates them entirely — these penalties are a consequence of
            the chosen order, not of your finances.
          </span>
        ) : (
          <span>
            <span className="font-semibold">
              Caution: penalty-free money alone is not enough in this plan —
              no withdrawal order avoids the penalty.
            </span>{" "}
            The projection is forced to pull {fmtMoney(penaltyDraws)} from
            retirement accounts before 59½, costing about{" "}
            {fmtMoney(totalPenalties)} in extra 10% penalties (rows flagged
            PENALTY in the table). The strategies at the bottom of this panel
            can shrink that gap.
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
                From penalty-free savings (cash, taxable, HSA
                {fromInherited > 0 ? ", inherited BCO" : ""})
              </div>
              <div className="font-bold text-sky-700 text-sm">
                {fmtMoney(fromCash + fromTaxable + fromHsa + fromInherited)}
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
          {(displayInputs.balanceInherited || 0) > 0 && (
            <li>
              <span className="font-medium">Inherited (BCO) account</span> —
              no early-withdrawal penalty at any age (death exception), and
              required payouts must come out on the beneficiary schedule
              anyway — so it bridges the gap before your own 401k/IRA are
              touched. Draws are ordinary income, so large ones can affect
              ACA subsidies and tax brackets.
            </li>
          )}
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
            <span className="font-medium">Roth conversions</span> (All settings →
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
          {strategyBest && strategyCurrent && strategyCurrent.penaltyTotal > 0 && (
            <li>
              <span className="font-medium">
                Change the cash withdrawal order
              </span>{" "}
              — verified against your projection: switching the Cash
              Withdrawal Strategy (All settings → Cash Strategy) to "
              {strategyBestLabel}"{" "}
              {strategyBest.penaltyTotal <= 0
                ? "eliminates the projected early-withdrawal penalties entirely."
                : `cuts the projected early-withdrawal penalties by about ${Math.round(
                    (1 - strategyBest.penaltyTotal / strategyCurrent.penaltyTotal) * 100,
                  )}%.`}
            </li>
          )}
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
        endYear: result.yearlyData.at(-1)?.year,
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

















// ============================================================
// SETTINGS IMPORT — parse the pasted "Label: value" text
// ============================================================
// Reverses SettingsExport's plain-text format: `## Section` headers plus
// `Label: Value` rows. Labels are matched case-insensitively against the same
// labels the export writes (plus a few sidebar aliases). A handful of labels
// are ambiguous on their own ("Balance", "Cost Basis") and are only matched
// inside the "Inherited (BCO)" section, so section context is tracked.



// value parsers shared by the field specs





// Each spec: internal field, value kind, accepted labels (normalized at match
// time), optional `requireSection` substring, optional `parseEnum`.






// Parse pasted settings text into an `updates` object plus applied/skipped
// summaries. Couple-mode text (Household / Primary / Spouse sections) is
// detected but not applied — flat individual fields would map incorrectly.


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
      wages: row.wages || 0,
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
        inherited: row.fromInherited || 0,
      },
      conversion: row.conversion,
      balances: {
        cash: row.cash,
        taxable: row.taxable,
        k401: row.k401,
        tradIra: row.tradIra,
        roth: row.roth,
        hsa: row.hsa,
        inherited: row.inherited || 0,
        total: row.total,
      },
      rmdAmount: row.rmdAmount || 0,
      inheritedRmdAmount: row.inheritedRmdAmount || 0,
      inheritedTaxable: row.inheritedTaxable || 0,
      inheritedWithdrawalCharge: row.inheritedWithdrawalCharge || 0,
      inheritedWithdrawalChargePolicy:
        row.inheritedWithdrawalChargePolicy || "unknown",
      inheritedPartialMinimumWarning:
        row.inheritedPartialMinimumWarning === true,
      inheritedBcoTerminated: row.inheritedBcoTerminated === true,
      inheritedFinalDistributionRequired:
        row.inheritedFinalDistributionRequired === true,
      inheritedFinalDistributionYear:
        row.inheritedFinalDistributionYear ?? null,
      surplusToCash: row.surplusToCash || 0,
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
      "Inherited BCO accounts are modeled as beneficiary-form accounts: an inherited 403(b)/TSA is a qualified plan account, not automatically an inherited IRA. The taxable portion is ordinary income, and beneficiary required distributions follow the selected federal payout rule.",
      "Contract-specific BCO terms are separate from federal rules. An owner-age final deadline is used only when configured from the contract (for example, an Equitable EQUI-VEST Series 201 endorsement), and its year is derived from the deceased owner's entered birth year. A configured contract deadline can shorten, but never extend, the federal 10-year deadline.",
      "The final BCO liquidation is a required distribution, not required spending. After tax, any excess follows the existing surplusToCash behavior in retirement; a full withdrawal terminates the BCO. Withdrawal charges are only treated as waived when the user selects the actual no-charge endorsement; standard/unknown schedules are not modeled.",
      "Cash can GROW during retirement: when forced withdrawals (RMDs, SEPP, inherited payouts) exceed spending + tax, the after-tax excess is deposited into Cash/HYSA (surplusToCash per row). Cash also earns the Cash/HYSA return. This is the standard answer to 'why is my cash balance increasing?'",
      "This is planning analysis, not tax, legal, investment, or fiduciary advice.",
    ],
  };
}

// Box-Muller transform for normal distribution






// ============================================================
// DIAGNOSE WHY SUCCESS RATE IS WHAT IT IS
// ============================================================



// Bisection on base lifestyle spending: the largest value (to the nearest
// $500) where the plan does not run out of money, holding every other input
// constant. Costs roughly 15-30 simulatePlan runs; callers must memoize.


// ============================================================
// CASH-STRATEGY PENALTY IMPACT — definitive, not hypothetical
// ============================================================
// The engine knows exactly whether a withdrawal order sends money through
// penalized accounts before 59½. Run the full projection once per strategy
// (everything else held constant) so the UI can state what WILL happen with
// the user's actual inputs and recommend the order that minimizes penalties.







// Given the impact map and the active strategy, pick the alternative order
// that cuts penalties the most without creating a new funding shortfall.
// Returns null when no alternative meaningfully beats the current one.


// Horizon-aware safe-withdrawal guideline. The classic 4% rule is calibrated
// to ~30-year retirements; longer horizons warrant a lower starting rate.


// Materiality bars for unmet cash flow, shared by EVERY surface that flags
// shortfalls (plan banner, depleted flag, Monte Carlo failure counting, the
// year-table SHORTFALL badge) so they can never disagree. The iterative
// tax/IRMAA solvers can leave a few dollars of rounding residue even in
// fully funded years (also smoothed by the engines' residue top-up); only
// treat unmet need as real once it clears these bars.





// Scan the projection for the first year the plan cannot fund itself and
// classify overall plan health for the always-visible status banner.
// Returns { status: "danger" | "warning" | "ok", ... }.




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
    "wages",
    "fica",
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
      <FinancialDetails values={person} onChange={onChange} personOnly scope={title} />
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
        label="Roth Contributions to Date"
        value={person.rothBasis || 0}
        onChange={onChange("rothBasis")}
        prefix="$"
        step={1000}
        hint="Lifetime contributions (not conversions/growth) — withdrawable anytime penalty-free. 0 if unsure."
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
        label="Annual Salary (Gross)"
        value={person.salaryIncome || 0}
        onChange={onChange("salaryIncome")}
        prefix="$"
        step={1000}
        hint="While working, taxes on RMDs/SS/pensions stack on top of this salary (its own tax stays outside the plan). After the other spouse retires it also funds this spouse's contributions (capped at pay), employee FICA, and household spending — $0 means contributions stop in those years."
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
        hint="62 (earliest) to 70; full benefit at your FRA (66–67 by birth year). Entries above 70 are treated as 70 (delayed credits stop there)."
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
  const id = useId();
  const display = isPercent ? Math.round(value * 10000) / 100 : value;
  const emit = (n) => {
    if (Number.isNaN(n)) return;
    onChange(isPercent ? n / 100 : n);
  };
  const clamped = Math.min(max, Math.max(min, display));
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-slate-600">{label}</label>
        <div className="relative">
          {prefix && (
            <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-400 text-[11px] pointer-events-none">
              {prefix}
            </span>
          )}
          <NumericField
            id={id}
            value={display}
            step={step}
            onValue={emit}
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

function KeyLevers({ inputs, isCouple, update, updateCouple, onSettings }) {
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
    <div className="quick-controls">
      <button
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 text-left px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 transition"
        title={open ? "Collapse the key levers" : "Expand the key levers"}
      >
        <span className="flex items-center gap-2">
          <span className="live-dot" aria-hidden="true" />
          <span className="text-sm font-semibold text-slate-900">
            Adjust your plan
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
        Change an assumption and see the graph update.
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
            step={500}
            prefix="$"
          />
          <LeverRow
            label="Return in retirement %"
            value={couple.shared.postReturn}
            onChange={updateCouple("shared", "postReturn")}
            min={2}
            max={10}
            step={0.1}
            isPercent
          />
        </>
      ) : (
        <>
          <LeverRow
            label="Retirement age"
            value={inputs.retirementAge}
            onChange={update("retirementAge")}
            min={50}
            max={75}
            step={1}
          />
          <LeverRow
            label="Lifestyle spending / year"
            value={inputs.baseExpenses}
            onChange={update("baseExpenses")}
            min={20000}
            max={200000}
            step={500}
            prefix="$"
          />
          <LeverRow
            label="Social Security claim age"
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
            step={0.1}
            isPercent
          />
          <LeverRow
            label="Return in retirement %"
            value={inputs.postReturn}
            onChange={update("postReturn")}
            min={2}
            max={10}
            step={0.1}
            isPercent
          />
        </>
      )}
      <p className="muted">Spending is in today's dollars and excludes healthcare.</p>
      <button className="text-action" onClick={onSettings}>All settings →</button>
      <p className="muted">Accounts, income, taxes and advanced rules.</p>
      </div>
      )}
    </div>
  );
}



// Cash drawdown controls — used by the individual sidebar and, in couple
// mode, the shared Household section (cash is a shared bucket).
// `penaltyImpact` is the per-strategy projection comparison computed in the
// main component, so the guidance below states what the user's actual plan
// DOES — never a hypothetical "can".
function CashStrategyInputs({
  values,
  onChange,
  earlyRetirement = false,
  penaltyImpact = null,
}) {
  const strategyId = useId();
  const strategy = values.cashStrategy || "cashFirst";
  const selected = CASH_STRATEGY_OPTIONS.find((o) => o.value === strategy);
  const reserveActive = strategy !== "cashFirst";
  const current = penaltyImpact?.[strategy];
  const best = penaltyImpact
    ? bestCashStrategyAlternative(penaltyImpact, strategy)
    : null;
  const bestLabel = best
    ? CASH_STRATEGY_OPTIONS.find((o) => o.value === best.value)?.label
    : null;
  return (
    <>
      <div className="mb-3">
        <label htmlFor={strategyId} className="block text-xs font-medium text-slate-600 mb-1">
          Cash Withdrawal Strategy
        </label>
        <select
          id={strategyId}
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
        {earlyRetirement && current && current.penaltyTotal <= 0 && (
          <p className="text-xs text-emerald-800 mt-1 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
            ✓ Checked against your projection: this withdrawal order triggers{" "}
            <span className="font-semibold">
              no 10% early-withdrawal penalties
            </span>{" "}
            before 59½.
          </p>
        )}
        {earlyRetirement && current && current.penaltyTotal > 0 && (
          <div className="text-xs text-amber-900 mt-1 bg-amber-50 border border-amber-300 rounded px-2 py-1.5 space-y-1">
            <p>
              <span className="font-semibold">
                With your inputs, this order pulls{" "}
                {fmtMoney(current.penalizedDraws)} from retirement accounts
                before 59½
              </span>{" "}
              — costing {fmtMoney(current.penaltyTotal)} in 10% penalties
              across {current.penaltyYears} year
              {current.penaltyYears === 1 ? "" : "s"} (ages{" "}
              {current.firstPenaltyAge}
              {current.lastPenaltyAge !== current.firstPenaltyAge
                ? `–${current.lastPenaltyAge}`
                : ""}
              , the PENALTY rows in the table).
            </p>
            {best && best.penaltyTotal <= 0 && (
              <p>
                <span className="font-semibold">
                  To be clear: you are not short of money.
                </span>{" "}
                Your penalty-free funds (cash, taxable, income) are enough to
                reach 59½ without touching retirement accounts at all — this
                penalty exists only because of the withdrawal order
                {strategy !== "cashFirst" &&
                (values.cashReserveFloor || 0) > 0
                  ? " and reserve floor"
                  : ""}{" "}
                selected here, not because of your finances.
              </p>
            )}
            {best ? (
              <p>
                <span className="font-semibold">
                  {best.penaltyTotal <= 0
                    ? `Fix: switch to "${bestLabel}" — it eliminates the penalty entirely`
                    : `Better: "${bestLabel}" cuts the penalty to ${fmtMoney(best.penaltyTotal)}`}
                </span>{" "}
                (lifetime taxes {fmtMoney(current.totalTaxes)} →{" "}
                {fmtMoney(best.totalTaxes)}; ending balance{" "}
                {fmtMoney(current.endBalance)} → {fmtMoney(best.endBalance)}).
                {best.value === "cashFirst" &&
                (values.cashReserveFloor || 0) > 0
                  ? ' Note: "Use cash first" ignores your protected reserve floor — the savings come from letting that cash be spent. If keeping the reserve matters more to you than the penalty, that is a legitimate choice; the numbers above show its exact price.'
                  : ""}
              </p>
            ) : (
              <p>
                <span className="font-semibold">
                  No withdrawal order avoids this penalty:
                </span>{" "}
                your penalty-free money (cash + taxable) can't cover the years
                before 59½ on its own. See the "Accessing Money Before 59½"
                panel for ways to close the gap — part-time income, lower
                spending, or retiring at 55+.
              </p>
            )}
          </div>
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

function CoupleInputs({ couple, updateCouple, penaltyImpact = null }) {
  const { primary, spouse, shared } = normalizeCoupleInputs(couple);
  const sharedChange = (key) => updateCouple("shared", key);
  return (
    <>
      <FinancialDetails values={shared} onChange={sharedChange} household />
      <Section title="Household" defaultOpen variant="household" badge="Shared">
        <div className="mb-3 rounded border border-indigo-200 bg-indigo-50 p-3 text-xs leading-relaxed text-indigo-900">
          Married-couple mode uses MFJ taxes, shared cash/taxable/expenses,
          and separate spouse timelines, accounts, Social Security, RMDs, and
          Roth conversions. Optional first-death scenarios use the account and benefit elections entered below.
          <span className="mt-1 block">
            <span className="font-semibold">Heads up:</span> with staggered
            retirements, enter the still-working spouse's{" "}
            <em>Annual Salary (Gross)</em> in their section. After the first
            spouse retires, that salary funds their contributions (capped at
            pay — a $0 salary means contributions stop), pays employee FICA,
            and the remainder covers household spending and is taxed; any
            after-tax surplus is saved to cash. Their workplace plan is
            shielded from withdrawals and RMDs until they retire.
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
          penaltyImpact={penaltyImpact}
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
      {(() => {
        // Staggered retirement: the household starts drawing down when the
        // FIRST spouse retires. If the other spouse keeps working but has no
        // salary entered, the projection funds full household spending from
        // the portfolio while still crediting that spouse's contributions.
        const primaryYears = primary.retirementAge - primary.currentAge;
        const spouseYears = spouse.retirementAge - spouse.currentAge;
        if (primaryYears === spouseYears) return null;
        const later = primaryYears > spouseYears ? primary : spouse;
        const laterLabel =
          (later === primary ? primary.name : spouse.name) ||
          (later === primary ? "Primary" : "Spouse");
        if ((later.salaryIncome || 0) > 0) return null;
        const gap = Math.abs(primaryYears - spouseYears);
        return (
          <div className="mb-3 p-2 bg-amber-50 border border-amber-300 rounded text-xs text-amber-900">
            <strong>⚠ Staggered retirement:</strong> {laterLabel} keeps
            working for {gap} more year{gap === 1 ? "" : "s"} after the
            household starts drawing down, but their Annual Salary (Gross) is
            $0. Those years will pull full household spending from the
            portfolio as if that paycheck didn't exist. Enter {laterLabel}
            's gross salary in their section below so it funds spending and is
            taxed while they still work.
          </div>
        );
      })()}
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
  const [baselineInputs, setBaselineInputs] = useState(() => captureBaseline(normalizeInputs(DEFAULT_INPUTS)));
  const [historyRequest, setHistoryRequest] = useState(0);
  const [selectedYear, setSelectedYear] = useState(null);
  const [scenarioRequest, setScenarioRequest] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [saveError, setSaveError] = useState('');
  const workspaceRef = useRef(null);
  const navigate = (destination) => {
    setActiveTab(destination === 'history' ? 'settings' : destination);
    if (destination === 'history') setHistoryRequest(value => value + 1);
    else setHistoryRequest(0);
    requestAnimationFrame(() => { window.scrollTo({top:0}); workspaceRef.current?.focus({preventScroll:true}); });
  };
  useEffect(() => {
    let opened = [];
    const prepare = () => { opened = [...document.querySelectorAll('details:not([open])')]; opened.forEach(el => { el.open = true; }); };
    const restore = () => opened.forEach(el => { el.open = false; });
    window.addEventListener('beforeprint', prepare);
    window.addEventListener('afterprint', restore);
    return () => { window.removeEventListener('beforeprint', prepare); window.removeEventListener('afterprint', restore); };
  }, []);
  const [mcRunning, setMcRunning] = useState(false);
  const [mcResults, setMcResults] = useState(null);
  // Inputs snapshot at the moment Monte Carlo last ran. Any input change
  // replaces the inputs object, so identity inequality means "stale".
  const mcInputsRef = useRef(null);
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | cleared
  const [diagnostics, setDiagnostics] = useState(null);
  // Controls the "Load Settings from Text" modal (opened from the toolbar).
  const [showImport, setShowImport] = useState(false);
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
  const baseline = useMemo(() => ({inputs: baselineInputs, results: simulatePlan(baselineInputs)}), [baselineInputs]);
  const comparison = useMemo(() => compareBaseline(baseline, inputs, results), [baseline, inputs, results]);
  // "How much can I actually spend?" — one number, solved by bisection.
  const maxSustainableSpending = useMemo(
    () => solveMaxSustainableSpending(inputs),
    [inputs],
  );
  // Early retirees: run the projection under each cash-withdrawal order so
  // the UI can state definitively what the chosen order costs in 10%
  // penalties and which order minimizes them.
  const cashStrategyImpact = useMemo(() => {
    if (getDisplayInputs(inputs).retirementAge >= 59.5) return null;
    return compareCashStrategies(inputs);
  }, [inputs]);

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
        setBaselineInputs(captureBaseline(normalizeInputs(active.inputs)));
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
    setSaveError(ok ? "" : "Could not save in this browser. Export your settings to keep a copy.");
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
    setScenarioRequest({kind: 'new', initial: suggested});
  };

  const submitScenarioName = async name => {
    if (scenarioRequest.kind === 'delete' && activeScenario) {
      await deleteConfirmedScenario();
    } else if (scenarioRequest.kind === 'rename' && activeScenario) {
      await persistStore(savedScenarios.map(item => item.id === activeScenario.id ? {...item,name} : item), activeScenario.id);
    } else {
      const scenario = { id: makeScenarioId(), name, inputs: captureBaseline(inputs), savedAt: Date.now() };
      await persistStore([...savedScenarios, scenario], scenario.id);
    }
    setScenarioRequest(null);
  };

  // Switch to a saved scenario, loading its inputs as the working set.
  const handleSelectScenario = async (id) => {
    if (!id) return;
    const scenario = savedScenarios.find((s) => s.id === id);
    if (!scenario) return;
    setInputs(normalizeInputs(scenario.inputs));
    setBaselineInputs(captureBaseline(normalizeInputs(scenario.inputs)));
    await persistStore(savedScenarios, id, "loaded");
  };

  const handleRenameScenario = () => {
    if (activeScenario) setScenarioRequest({kind:'rename', initial:activeScenario.name});
  };

  const handleDeleteScenario = () => {
    if (activeScenario) setScenarioRequest({kind:'delete', initial:activeScenario.name});
  };

  const deleteConfirmedScenario = async () => {
    if (!activeScenario) return;
    const next = savedScenarios.filter((s) => s.id !== activeScenario.id);
    const nextActiveId = next[0]?.id ?? null;
    if (nextActiveId) {
      const nextActive = next.find((s) => s.id === nextActiveId);
      if (nextActive) {
        setInputs(normalizeInputs(nextActive.inputs));
        setBaselineInputs(captureBaseline(normalizeInputs(nextActive.inputs)));
      }
    }
    await persistStore(next, nextActiveId, "cleared");
  };

  // Reset only the working inputs to built-in defaults; does not delete scenarios.
  const handleResetToDefaults = () => {
    setInputs(normalizeInputs(DEFAULT_INPUTS));
    setBaselineInputs(captureBaseline(normalizeInputs(DEFAULT_INPUTS)));
    setActiveScenarioId(null);
    setSaveStatus("cleared");
    setTimeout(() => setSaveStatus("idle"), 2500);
  };

  // Apply a parsed settings block (from SettingsImport). Treated like editing
  // the inputs by hand: it becomes an unsaved working plan, and cached derived
  // results (Monte Carlo, diagnostics) are invalidated so they recompute.
  const handleImportSettings = (updates) => {
    setInputs((prev) => normalizeInputs({ ...prev, ...updates }));
    setActiveScenarioId(null);
    setMcResults(null);
    setDiagnostics(null);
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

  const printReport = () => {
    const previousTab = activeTab;
    const restore = () => setActiveTab(previousTab);
    window.addEventListener('afterprint', restore, {once:true});
    setActiveTab('plan');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try { window.print(); }
      finally {
        window.removeEventListener('afterprint', restore);
        restore();
      }
    }));
  };

  const currentYear = results.yearlyData[0]?.year ?? PROJECTION_START_YEAR;
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
      wages: (row.wages || 0) * factor,
      ficaTax: (row.ficaTax || 0) * factor,
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
      fromInherited: (row.fromInherited || 0) * factor,
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
      inherited: (row.inherited || 0) * factor,
      total: row.total * factor,
      rmdAmount: (row.rmdAmount || 0) * factor,
      inheritedRmdAmount: (row.inheritedRmdAmount || 0) * factor,
      inheritedTaxable: (row.inheritedTaxable || 0) * factor,
      inheritedWithdrawalCharge: (row.inheritedWithdrawalCharge || 0) * factor,
      surplusToCash: (row.surplusToCash || 0) * factor,
      surplusToTaxable: (row.surplusToTaxable || 0) * factor,
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
  const baselineValues = baselineSeries(baseline, results.yearlyData, showRealDollars);
  const chartData = results.yearlyData.map((raw, index) => { const d = adjustRow(raw); return ({
    ...d,
    Baseline: baselineValues[index],
    age: d.age,
    axisLabel: formatAxisLabel(d, isCouple),
    Cash: d.cash,
    Taxable: d.taxable,
    [employerPlanChartKey]: d.k401,
    "Trad IRA": d.tradIra,
    Roth: d.roth,
    HSA: d.hsa,
    Inherited: d.inherited || 0,
    "Annual Spending": d.phase === "accumulation" ? null : d.spending,
  }); });

  const flowData = results.yearlyData
    .filter((d) => d.phase !== "accumulation")
    .map((raw) => { const d = adjustRow(raw); return ({
      ...d,
      age: d.age,
      axisLabel: formatAxisLabel(d, isCouple),
      "Part-Time": d.partTime,
      "Social Security": d.ss,
      Pension: d.pension || 0,
      Cash: d.fromCash,
      Taxable: d.fromTaxable,
      Inherited: d.fromInherited || 0,
      [employerPlanChartKey]: d.from401k,
      IRA: d.fromIra,
      Roth: d.fromRoth,
      HSA: d.hsaWithdrawal,
      Spending: d.spending,
      "Need (Spending + Tax)": d.spending + d.tax,
      ownerDetails: d.ownerDetails,
    }); });
  const chartAxisTicks = isCouple ? buildReadableAxisTicks(chartData, 7)
    : chartData.filter((row, index) => index === 0 || index === chartData.length - 1 || row.age % 10 === 0).map(row => row.axisLabel);
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
  const showInheritedCol = (displayInputs.balanceInherited || 0) > 0;
  const yearDetailColSpan =
    (displayInputs.pensionIncome > 0 ? 16 : 15) + (showInheritedCol ? 1 : 0);
  // For an already-retired user the "portfolio at retirement" metric describes
  // the end of the first projected year, which happens at the current age.
  const retirementDisplayAge = Math.max(
    displayInputs.retirementAge,
    displayInputs.currentAge,
  );

  return (
    <div className="planner-app min-h-screen bg-slate-50 text-slate-900">
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
              Retirement age {displayInputs.retirementAge} → Plan through age{" "}
              {displayInputs.planThroughAge}
            </p>
          </div>
        </div>
      </div>

      {/* Header */}
      <header className="planner-header print:hidden">
        <h1>Retirement Planner</h1>
        <div className="scenario-toolbar">
          <label className="sr-only" htmlFor="scenario-picker">Active scenario</label>
          <select id="scenario-picker" value={activeScenarioId ?? ''} onChange={event => handleSelectScenario(event.target.value)}>
            {(!hasSavedScenarios || !activeScenarioId) && <option value="">Unsaved plan</option>}
            {savedScenarios.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <span className="save-state" role="status">{saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : activeScenario && !isDirty ? 'Saved scenario' : 'Unsaved changes'}</span>
          <button className="primary-action" onClick={handleSaveScenario} disabled={saveStatus === 'saving'}>{activeScenario ? 'Save changes' : 'Save scenario'}</button>
          <details className="scenario-menu"><summary>More <span aria-hidden="true">⌄</span></summary><div onClick={event => { if (event.target.closest('button')) event.currentTarget.parentElement.open = false; }}>
            <button onClick={handleSaveAsScenario}>Save as new…</button>
            <button onClick={handleRenameScenario} disabled={!activeScenario}>Rename scenario</button>
            <button onClick={handleDeleteScenario} disabled={!activeScenario}>Delete scenario</button>
            <button onClick={() => setShowImport(true)}>Import settings</button>
            <button onClick={() => { navigate('years'); requestAnimationFrame(() => {
              const section = document.getElementById('settings-export');
              const toggle = section?.querySelector('button');
              if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click();
              section?.scrollIntoView({ block: 'start' });
              toggle?.focus({ preventScroll: true });
            }); }}>Export settings</button>
            <button onClick={printReport}>Save as PDF</button>
            <button onClick={reset}>Reset to defaults</button>
          </div></details>
        </div>
      </header>
      <div className="navigation-row print:hidden"><WorkspaceNav active={activeTab} onNavigate={navigate} />
        <button className="assistant-launch" aria-expanded={chatOpen} onClick={() => setChatOpen(!chatOpen)}>Ask about this plan</button></div>
      {scenarioRequest && <ScenarioDialog request={scenarioRequest} onSubmit={submitScenarioName} onClose={() => setScenarioRequest(null)} />}
      {saveError && <p role="alert" className="save-error">{saveError}</p>}

      {/* Load-from-text modal — reachable from the toolbar on any tab */}
      <SettingsImport
        open={showImport}
        onClose={() => setShowImport(false)}
        onApply={handleImportSettings}
      />

      <div className="dashboard-overview">
        <div className="overview-heading"><h2 ref={workspaceRef} tabIndex={-1}>{activeTab === 'plan' ? 'Your retirement outlook' : activeTab === 'settings' ? 'Plan assumptions' : activeTab === 'years' ? 'Year-by-year breakdown' : activeTab === 'compare' ? 'Compare retirement and spending' : 'Risk analysis'}</h2>
          <div className="dollar-switch" role="group" aria-label="Display dollars"><button aria-pressed={!showRealDollars} onClick={() => setShowRealDollars(false)}>Future dollars</button><button aria-pressed={showRealDollars} onClick={() => setShowRealDollars(true)}>Today's dollars</button></div></div>
        <div className="overview-row"><div className="overview-metrics">
          <CompactMetric label={'Portfolio at age '+retirementDisplayAge} value={fmtMoney(adjust(s.portfolioAtRetirement,currentYear+retirementDisplayAge-displayInputs.currentAge))} tone="positive" detail={'End of the first projected retirement year. Current portfolio: '+fmtMoney(s.currentTotal)+'. Values use the selected dollar basis.'} />
          <CompactMetric label={'Portfolio at age '+displayInputs.planThroughAge} value={fmtMoney(adjust(s.portfolioAtEnd,currentYear+displayInputs.planThroughAge-displayInputs.currentAge))} tone={s.portfolioAtEnd <= 0 ? 'negative' : ''} detail="End-of-plan account balances. A positive balance alone does not rule out an earlier cash-flow shortfall; review the plan status." />
          <CompactMetric label="First-year withdrawal" value={fmtPct(s.year1WithdrawalRate)} tone="caution" detail={'Includes withdrawals to fund taxes. Compare with the '+fmtPct(shortfall.guideline)+' guideline for this '+shortfall.retirementYears+'-year retirement.'} />
          <CompactMetric label="Total Roth converted" value={fmtMoney(s.totalConverted)} detail={'Total transferred over the plan, in future dollars. Lifetime taxes: '+fmtMoney(s.totalTaxesPaid)+'. These sums are not today’s purchasing power.'} />
        </div><div className="overview-notices">
          <div className={'compact-health '+(s.calculationValid === false || shortfall.status === 'danger' ? 'danger' : shortfall.status === 'warning' ? 'caution' : 'funded')}>
            <strong>{shortfall.status === 'danger' ? (s.calculationValid === false ? 'Estimate: shortfall at age ' : 'Projected shortfall at age ')+(shortfall.firstShortfallAge ?? '—')+(isCouple ? ' (primary)' : '') : s.calculationValid === false ? 'Estimate: calculation needs review' : shortfall.status === 'warning' ? 'Plan funded with a thin margin' : 'Plan funded through age '+displayInputs.planThroughAge}</strong>
            <button onClick={() => { setSelectedYear(results.yearlyData.find(row => row.age === shortfall.firstShortfallAge)?.year ?? null); navigate('years'); }}>View years →</button>
          </div>
          {s.modelNotices?.length > 0 && <details className="compact-notices"><summary>{s.modelNotices.length} financial details need review</summary><div><p>Estimates remain provisional. Sustainable spending is withheld while material inputs are unresolved.</p><ul>{s.modelNotices.map(notice => <li key={notice}>{notice}</li>)}</ul></div></details>}
          {s.modelNotices?.length > 0 && <button className="review-link" onClick={() => navigate('history')}>Review financial details →</button>}
        </div></div>
      </div>

      {/* Main layout */}
      <div className={`planner-workspace workspace-${activeTab}`}>
        {/* Inputs sidebar — its own scroll container on desktop so the
            input list and the results never fight over one scrollbar. */}
        <aside className="quick-sidebar print:hidden">
          <KeyLevers inputs={inputs} isCouple={isCouple} update={update} updateCouple={updateCouple} onSettings={() => navigate('settings')} />
          <BaselineControls comparison={comparison} onCapture={() => setBaselineInputs(captureBaseline(inputs))} onRestore={() => { setInputs(captureBaseline(baselineInputs)); setMcResults(null); }} />
        </aside>
        <div className={activeTab === 'settings' ? 'settings-view print:hidden' : 'settings-view hidden print:hidden'}>
        <SettingsWorkspace scope={isCouple ? 'couple' : 'individual'} historyRequest={historyRequest} notices={s.modelNotices}>
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
            <h2 className="text-base font-bold text-slate-900 mb-1">
              Household and filing status
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
                <div className="mt-3">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    I file federal taxes as
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => update("filingStatus")("single")}
                      className={`rounded border px-3 py-2 text-xs font-semibold transition ${
                        inputs.filingStatus !== "mfj"
                          ? "border-indigo-600 bg-indigo-600 text-white"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      Single
                    </button>
                    <button
                      type="button"
                      onClick={() => update("filingStatus")("mfj")}
                      className={`rounded border px-3 py-2 text-xs font-semibold transition ${
                        inputs.filingStatus === "mfj"
                          ? "border-indigo-600 bg-indigo-600 text-white"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      Married (joint)
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">
                    {inputs.filingStatus === "mfj"
                      ? "All taxes use married-filing-jointly brackets — for married people modeling only their own accounts."
                      : "All taxes use single-filer federal and NY brackets, thresholds, and Medicare (IRMAA) tiers."}
                  </p>
                  <p className="mt-1.5 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs leading-relaxed text-slate-600">
                    <span className="font-semibold">Recently widowed?</span>{" "}
                    You can usually still file jointly for the year your
                    spouse passed, and — if you have a dependent child — as a
                    qualifying surviving spouse (joint rates) for up to two
                    more years. Model those years with "Married (joint)",
                    then switch to "Single". Ask your tax preparer which
                    applies to you.
                  </p>
                </div>
              )}
            </div>

            {isCouple ? (
              <CoupleInputs
                couple={inputs.couple}
                updateCouple={updateCouple}
                penaltyImpact={cashStrategyImpact}
              />
            ) : (
              <>

            <FinancialDetails values={inputs} onChange={update} />
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
                label="Roth Contributions to Date"
                value={inputs.rothBasis || 0}
                onChange={update("rothBasis")}
                prefix="$"
                step={1000}
                hint="Lifetime contributions (not conversions or growth) — withdrawable anytime penalty-free before 59½. Leave 0 if unsure (conservative)."
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

            <Section title="Inherited BCO Account" badge="Beneficiary" icon="🎗️">
              <NumberInput
                label="Inherited Account Balance"
                value={inputs.balanceInherited || 0}
                onChange={update("balanceInherited")}
                prefix="$"
                step={1000}
                hint="An inherited retirement account or annuity kept in beneficiary form under a Beneficiary Continuation Option. Leave $0 if none."
                info={TERM_HELP.bco}
              />
              {(inputs.balanceInherited || 0) > 0 && (
                <>
                  <SelectInput
                    label="Inherited Plan Type"
                    value={inputs.inheritedPlanType || "qualifiedOther"}
                    onChange={(val) =>
                      setInputs((prev) =>
                        normalizeInputs({
                          ...prev,
                          inheritedPlanType: val,
                          inheritedTaxType:
                            val === "nonqualifiedAnnuity"
                              ? "nonqualified"
                              : "qualified",
                        }),
                      )
                    }
                    options={[
                      {
                        value: "403bTsa",
                        label: "403(b) TSA / public-school plan",
                      },
                      { value: "ira", label: "Inherited IRA" },
                      {
                        value: "qualifiedOther",
                        label: "Other qualified retirement plan",
                      },
                      {
                        value: "nonqualifiedAnnuity",
                        label: "Nonqualified annuity",
                      },
                    ]}
                    hint={
                      (inputs.inheritedPlanType || "qualifiedOther") ===
                      "nonqualifiedAnnuity"
                        ? "Taxed earnings-first (IRC §72(e)): fully taxable ordinary income until only your cost basis remains, then tax-free."
                        : "Every withdrawal is ordinary income (pre-tax money) — but never the 10% early penalty. An inherited 403(b)/TSA is a qualified PLAN account, not an inherited IRA."
                    }
                  />
                  <TextInput
                    label="Contract / Product"
                    value={inputs.inheritedContractLabel || ""}
                    onChange={update("inheritedContractLabel")}
                    hint={
                      'Optional label, e.g. "Equitable EQUI-VEST Series 201 — TSA Public School".'
                    }
                  />
                  {(inputs.inheritedPlanType || "qualifiedOther") ===
                    "nonqualifiedAnnuity" && (
                    <NumberInput
                      label="Cost Basis (Investment in Contract)"
                      value={inputs.inheritedBasis || 0}
                      onChange={update("inheritedBasis")}
                      prefix="$"
                      step={1000}
                      hint="After-tax dollars originally paid into the annuity (on the contract statement). This portion comes back tax-free after gains distribute."
                    />
                  )}
                  <SelectInput
                    label="Payout Rule"
                    value={inputs.inheritedPayoutRule || "lifeExpectancy"}
                    onChange={update("inheritedPayoutRule")}
                    options={[
                      {
                        value: "lifeExpectancy",
                        label:
                          "Life expectancy / stretch — subject to beneficiary eligibility and BCO terms",
                      },
                      { value: "tenYear", label: "Federal 10-year rule" },
                    ]}
                    hint={
                      (inputs.inheritedPayoutRule || "lifeExpectancy") ===
                      "tenYear"
                        ? `Federal deadline: everything must be distributed by Dec 31, ${
                            (inputs.inheritedDeathYear || PROJECTION_START_YEAR) +
                            10
                          }. A contract deadline can only shorten this, never extend it.`
                        : "Annual required payouts over your single-life expectancy — available to a surviving spouse and other eligible designated beneficiaries. A contract-specific BCO deadline (below) may still force full distribution earlier."
                    }
                  />
                  <SelectInput
                    label="Your Relationship to the Owner"
                    value={inputs.inheritedRelationship || "spouse"}
                    onChange={update("inheritedRelationship")}
                    options={[
                      { value: "spouse", label: "Surviving spouse" },
                      { value: "nonSpouse", label: "Other beneficiary" },
                    ]}
                    hint="A surviving spouse recalculates life expectancy each year and may delay required payouts until the year the owner would have reached RMD age."
                  />
                  <NumberInput
                    label="Year of Owner's Death"
                    value={inputs.inheritedDeathYear || PROJECTION_START_YEAR}
                    onChange={update("inheritedDeathYear")}
                    hint="Required payouts are measured from this year."
                  />
                  <NumberInput
                    label="Owner's Birth Year"
                    value={inputs.inheritedDeceasedBirthYear || 1965}
                    onChange={update("inheritedDeceasedBirthYear")}
                    hint="Sets the owner's RMD age and any contract age-based final distribution year. Enter the actual birth year — an owner who died in 2026 at 55 may have been born in 1970 or 1971, and the contract deadline differs by a year."
                  />
                  <SelectInput
                    label="Owner RMD Status"
                    value={inputs.inheritedOwnerRmdStatus || "auto"}
                    onChange={update("inheritedOwnerRmdStatus")}
                    options={[
                      { value: "auto", label: "Auto (infer from years)" },
                      {
                        value: "beforeRbd",
                        label: "Died before required beginning date",
                      },
                      {
                        value: "onOrAfterRbd",
                        label: "Died on or after required beginning date",
                      },
                    ]}
                    hint="Controls whether annual distributions are required in years 1–9 of the 10-year rule and when spousal life-expectancy payouts must begin. Auto uses a whole-calendar-year approximation; the exact required beginning date can depend on the owner's birthday, retirement status, plan provisions, and federal rules."
                  />
                  <SelectInput
                    label="Withdrawal-Charge Treatment"
                    value={
                      inputs.inheritedWithdrawalChargePolicy || "unknown"
                    }
                    onChange={update("inheritedWithdrawalChargePolicy")}
                    options={[
                      {
                        value: "bcoNoCharge",
                        label: "BCO endorsement: no withdrawal charge",
                      },
                      {
                        value: "standardContract",
                        label: "Standard contract schedule — not modeled",
                      },
                      { value: "unknown", label: "Unknown — verify contract" },
                    ]}
                    hint={
                      (inputs.inheritedWithdrawalChargePolicy || "unknown") ===
                      "bcoNoCharge"
                        ? "Your BCO endorsement overrides the standard contract surrender schedule: withdrawals are modeled with NO charge."
                        : "The projection applies NO charge because the exact contract schedule is not modeled — a zero here does not prove the real contract charges nothing. Verify the schedule with the insurer."
                    }
                  />
                  {(inputs.inheritedWithdrawalChargePolicy || "unknown") !==
                    "bcoNoCharge" && (
                    <div className="mb-3 p-2 bg-amber-50 border border-amber-300 rounded text-xs text-amber-900">
                      ⚠ The contract's withdrawal-charge schedule is{" "}
                      <span className="font-semibold">not modeled</span>. The
                      projection assumes $0 in charges, which may understate
                      costs. Confirm the schedule (or a BCO no-charge
                      endorsement) with the insurer.
                    </div>
                  )}
                  <NumberInput
                    label="Partial Withdrawal Minimum"
                    value={inputs.inheritedPartialWithdrawalMinimum || 0}
                    onChange={update("inheritedPartialWithdrawalMinimum")}
                    prefix="$"
                    step={50}
                    hint="Contract minimum for partial withdrawals. This does not change federal RMD calculations. A full withdrawal is treated separately."
                  />
                  <SelectInput
                    label="Contract Final Distribution Rule"
                    value={
                      inputs.inheritedContractFinalDistributionMode || "none"
                    }
                    onChange={update("inheritedContractFinalDistributionMode")}
                    options={[
                      {
                        value: "none",
                        label: "No contract-specific final deadline",
                      },
                      {
                        value: "ownerAge",
                        label: "Deceased owner's age at final distribution",
                      },
                      { value: "explicitYear", label: "Specific calendar year" },
                    ]}
                    hint="A BCO endorsement may require full distribution by a contract-specific date — e.g. when the deceased owner would have reached a stated age. This is a CONTRACT term, not a federal rule, and it never extends the federal 10-year deadline."
                  />
                  {(inputs.inheritedContractFinalDistributionMode || "none") ===
                    "ownerAge" && (
                    <NumberInput
                      label="Deceased Owner's Final Distribution Age"
                      value={
                        inputs.inheritedContractFinalDistributionAge || 72
                      }
                      onChange={update("inheritedContractFinalDistributionAge")}
                      hint="From the BCO endorsement (72 for the Equitable Series 201 BCO). Final year = owner's birth year + this age."
                    />
                  )}
                  {(inputs.inheritedContractFinalDistributionMode || "none") ===
                    "explicitYear" && (
                    <NumberInput
                      label="Contract Final Distribution Year"
                      value={
                        inputs.inheritedContractFinalDistributionYear || 0
                      }
                      onChange={update("inheritedContractFinalDistributionYear")}
                      hint="Calendar year by which the contract requires the account to be fully distributed."
                    />
                  )}
                  <TextInput
                    label="Contract Source Note"
                    value={inputs.inheritedContractSourceNote || ""}
                    onChange={update("inheritedContractSourceNote")}
                    hint={
                      'Where these contract terms came from, e.g. "Equitable Series 201 BCO endorsement". Documentation only.'
                    }
                  />
                  {(() => {
                    const deadlines = resolveInheritedFinalDistributionYear({
                      payoutRule:
                        inputs.inheritedPayoutRule || "lifeExpectancy",
                      deathYear:
                        inputs.inheritedDeathYear || PROJECTION_START_YEAR,
                      deceasedBirthYear:
                        inputs.inheritedDeceasedBirthYear || 1965,
                      contractMode:
                        inputs.inheritedContractFinalDistributionMode ||
                        "none",
                      contractAge:
                        inputs.inheritedContractFinalDistributionAge || 72,
                      contractYear:
                        inputs.inheritedContractFinalDistributionYear || 0,
                    });
                    const horizonEndYear =
                      PROJECTION_START_YEAR +
                      ((inputs.planThroughAge || 0) -
                        (inputs.currentAge || 0));
                    const horizonReaches =
                      deadlines.effectiveDeadline == null ||
                      horizonEndYear >= deadlines.effectiveDeadline;
                    const contractEarlierThanFederal =
                      deadlines.federalDeadline != null &&
                      deadlines.contractDeadline != null &&
                      deadlines.contractDeadline < deadlines.federalDeadline;
                    return (
                      <div className="mb-3 p-2 bg-slate-50 border border-slate-200 rounded text-xs text-slate-700 space-y-1">
                        <div className="font-semibold text-slate-800">
                          Calculated distribution deadlines
                        </div>
                        <div>
                          Contract BCO final distribution year:{" "}
                          <span className="font-semibold">
                            {deadlines.contractDeadline ?? "none"}
                          </span>
                        </div>
                        <div>
                          Federal 10-year deadline:{" "}
                          <span className="font-semibold">
                            {deadlines.federalDeadline ??
                              "n/a (life-expectancy option)"}
                          </span>
                        </div>
                        <div>
                          Effective final distribution year:{" "}
                          <span className="font-semibold">
                            {deadlines.effectiveDeadline ??
                              "none — annual payouts continue"}
                          </span>
                        </div>
                        {deadlines.effectiveDeadline != null && (
                          <div>
                            Projection horizon ({horizonEndYear}){" "}
                            {horizonReaches ? "reaches" : "does NOT reach"} the
                            required liquidation year.
                          </div>
                        )}
                        {contractEarlierThanFederal && (
                          <div className="text-amber-800">
                            ⚠ The contract deadline (
                            {deadlines.contractDeadline}) is earlier than the
                            federal 10-year deadline (
                            {deadlines.federalDeadline}); the earlier contract
                            date governs.
                          </div>
                        )}
                        {!horizonReaches && (
                          <div className="text-amber-800">
                            ⚠ The projection ends before the required
                            liquidation year — extend "Plan Through Age" to
                            see the forced full distribution.
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded px-2 py-1.5 mb-2">
                    This is an inherited 403(b)/TSA, not an inherited IRA,
                    when the 403(b) plan type is selected. Federal beneficiary
                    distribution rules are modeled separately from the
                    Equitable contract's BCO provisions. The actual BCO
                    endorsement controls withdrawal charges and the
                    contract-specific final distribution date. Product-level
                    fees (variable-account expenses, fund expenses,
                    administrative charges) and standard surrender schedules
                    are NOT modeled.
                  </p>
                  <p className="text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded px-2 py-1.5 mb-2">
                    ⚠ Verify the BCO election, beneficiary status,
                    sole-beneficiary status, final distribution age, and plan
                    provisions with Equitable or the plan administrator.
                  </p>
                  <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5">
                    ✓ Withdrawals from this account are modeled with{" "}
                    <span className="font-semibold">
                      no 10% early-withdrawal penalty at any age
                    </span>{" "}
                    (IRS death exception). The taxable portion is still ordinary
                    income. Keeping the account in beneficiary (BCO) form
                    preserves the exemption — electing spousal continuation
                    (retitling it as your own) is NOT modeled and would change
                    both the penalty treatment and the distribution schedule.
                  </p>
                </>
              )}
            </Section>

            <Section title="Cash Strategy" badge="Drawdown" icon="🏦">
              <CashStrategyInputs
                values={inputs}
                onChange={update}
                earlyRetirement={inputs.retirementAge < 59.5}
                penaltyImpact={cashStrategyImpact}
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
                label="Annual Salary (Gross)"
                value={inputs.salaryIncome || 0}
                onChange={update("salaryIncome")}
                prefix="$"
                step={1000}
                hint="Pre-retirement taxes only: RMDs, inherited payouts, SS, and pensions received while still working are taxed on top of this salary instead of from the bottom brackets. Funds the contributions you request. Salary living costs remain outside accumulation projections; $0 permits no contributions."
              />
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
                hint="62 (earliest) to 70; full benefit at your FRA (66–67 by birth year). Entries above 70 are treated as 70 (delayed credits stop there)."
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
                hint="Today's dollars at benefit start: inflated to commencement at your general inflation rate, then the Pension COLA applies once payments begin"
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
                hint={`Tip: many people size this so taxable income stays inside the 12% federal bracket (about ${inputs.filingStatus === "mfj" ? "$100,800 for a couple" : "$50,400 for a single filer"} in 2026)`}
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
              {inputs.retirementAge < 59.5 && (
                <div className="mb-3 mt-2 p-2 bg-slate-50 rounded border border-slate-200">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={inputs.useSepp === true}
                      onChange={(e) => update("useSepp")(e.target.checked)}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="text-xs font-medium text-slate-700">
                        Model a SEPP / 72(t) program
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Fixed-amortization payments from your 401k/IRA, taken
                        every year from retirement until the later of 5 years
                        or 59½ — penalty-free up to the payment amount. Rigid in
                        real life: breaking the schedule triggers retroactive
                        penalties (not modeled).
                      </div>
                    </div>
                  </label>
                  {inputs.useSepp && (
                    <div className="mt-2">
                      <PctInput
                        label="SEPP Interest Rate"
                        value={inputs.seppRate ?? 0.05}
                        onChange={update("seppRate")}
                        hint="Legal cap: 120% of the federal mid-term rate (AFR) for the start month — verify the current AFR before relying on this."
                      />
                    </div>
                  )}
                </div>
              )}
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
        </SettingsWorkspace>
        </div>

        {/* Results area */}
        <main className="workspace-main min-w-0 space-y-6 print:space-y-3">
          <div className={activeTab === 'plan' || activeTab === 'years' ? 'plan-report space-y-6' : 'plan-report hidden print:block'}>
          <div className="dashboard-charts space-y-6">
          {/* Portfolio composition chart */}
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm print:shadow-none print:border-slate-300 print-avoid-break">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Portfolio over time
                </h2>
                <details className="chart-explainer"><summary>Account composition, withdrawals and baseline</summary><p className="text-xs text-slate-500 mt-0.5">
                  Watch how each account evolves through accumulation and
                  drawdown. In married-couple mode, spouse-owned retirement
                  accounts are combined here and split in the year-by-year detail.
                  If Cash grows in later years, that's not a mistake: required
                  withdrawals (RMDs) often force out more than you spend, and
                  the after-tax excess is re-saved into Cash/HYSA — look for the{" "}
                  <span className="text-[10px] font-medium bg-sky-100 text-sky-800 px-1 py-0.5 rounded">→CASH</span>{" "}
                  badge in the year-by-year table. The dotted baseline follows the same calendar years; missing years are not extrapolated.
                </p></details>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={360}>
              <ComposedChart data={chartData} accessibilityLayer>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <Line type="monotone" dataKey="Baseline" stroke="#4f46e5" strokeWidth={2} strokeDasharray="4 4" dot={false} connectNulls={false} isAnimationActive={false} />
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
                {(displayInputs.balanceInherited || 0) > 0 && (
                  <Area
                    type="monotone"
                    dataKey="Inherited"
                    name="Inherited (BCO)"
                    stackId="1"
                    stroke="#4d7c0f"
                    fill="#bef264"
                  />
                )}
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

          <ExploreDetails onNavigate={navigate} noticeCount={s.modelNotices?.length || 0} />
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
                {(displayInputs.balanceInherited || 0) > 0 && (
                  <Bar
                    dataKey="Inherited"
                    name="Inherited (BCO)"
                    stackId="sources"
                    fill="#84cc16"
                  />
                )}
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

          </div>
          <details className="plan-explanation"><summary>Plan explanation, retirement phases and withdrawal strategy</summary>
          <div className="space-y-6 explanation-body">
          <PlanStatusBanner shortfall={shortfall} calculationValid={s.calculationValid} planThroughAge={displayInputs.planThroughAge} isCouple={isCouple} maxSustainableSpending={maxSustainableSpending} plannedSpending={displayInputs.baseExpenses} />
          <PlanNarrative narrative={planNarrative} />
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
            cashStrategyImpact={cashStrategyImpact}
          />

          </div></details>
          <div className="year-workspace space-y-6">
          <YearInspector row={results.yearlyData.find(row => row.year === selectedYear) ?? results.yearlyData.find(row => row.phase !== 'accumulation') ?? results.yearlyData[0]} rows={results.yearlyData} onSelect={setSelectedYear} real={showRealDollars} inflation={displayInputs.inflation} firstYear={currentYear}>
            {isCouple && <CoupleOwnerDetailGrid ownerDetails={adjustRow(results.yearlyData.find(row => row.year === selectedYear) ?? results.yearlyData.find(row => row.phase !== 'accumulation') ?? results.yearlyData[0]).ownerDetails} />}
          </YearInspector>
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
                  <span className="text-[10px] font-medium bg-sky-100 text-sky-800 px-1.5 py-0.5 rounded">
                    →CASH
                  </span>{" "}
                  = forced withdrawals exceeded spending; the excess was saved
                  to Cash/HYSA (why cash grows in RMD years),{" "}
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

            <div className="year-table-scroll overflow-auto max-h-[600px] print:max-h-none print:overflow-visible" role="region" aria-label="Year-by-year projection table" tabIndex={0}>
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
                      colSpan={showInheritedCol ? 7 : 6}
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
                    {showInheritedCol && (
                      <th
                        className="px-3 py-2 text-right font-semibold text-sky-700 bg-sky-50"
                        title="Withdrawals from the inherited account held under a Beneficiary Continuation Option — penalty-free at any age"
                      >
                        BCO
                      </th>
                    )}
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
                      // Same per-year materiality bar as the banner and Monte
                      // Carlo: a few dollars of solver rounding residue must
                      // not paint a funded year as a SHORTFALL.
                      const isShortfallYear =
                        (rawRow.unmetCashFlow || 0) >
                          materialYearUnmetThreshold(
                            results.summary.year1Spending,
                          ) || rawRow.total <= 0;
                      return (
                        <Fragment key={d.year}>
                        <tr
                          className={
                            isShortfallYear
                              ? "border-b border-rose-200 bg-rose-50 hover:bg-rose-100"
                              : "border-b border-slate-100 hover:bg-slate-50"
                          }
                        >
                          <td className="year-identity px-3 py-1.5 font-semibold"><button aria-label={`Inspect year ${d.year}`} onClick={() => { setSelectedYear(d.year); document.querySelector('.year-inspector')?.scrollIntoView({block:'start'}); }}>
                            {isCouple && d.spouseAge != null
                              ? (
                                <span className="inline-flex flex-col leading-tight">
                                  <span>{d.year}</span>
                                  <span className="text-[10px] font-normal text-slate-500">
                                    {Math.round(d.primaryAge ?? d.age)} / {Math.round(d.spouseAge)}
                                  </span>
                                </span>
                              )
                              : d.age}</button>
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
                              {d.surplusToCash > 500 && (
                                <span
                                  className="text-[10px] font-medium bg-sky-100 text-sky-800 px-1.5 py-0.5 rounded"
                                  title={`Required withdrawals exceeded spending + tax by ${fmtMoney(d.surplusToCash)}. That after-tax excess was deposited into Cash/HYSA — it is not extra spending, and it is why the cash balance grows in RMD years.`}
                                >
                                  →CASH
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
                          {showInheritedCol && (
                            <td
                              className={`px-3 py-1.5 text-right ${
                                d.fromInherited > 0
                                  ? "text-sky-700 font-medium"
                                  : "text-slate-300"
                              }`}
                              title={
                                d.fromInherited > 0
                                  ? `Inherited (BCO) draw — no 10% early penalty at any age (death exception).${
                                      d.inheritedRmdAmount > 0
                                        ? ` Required this year: ${fmtMoney(d.inheritedRmdAmount)}.`
                                        : ""
                                    }`
                                  : undefined
                              }
                            >
                              {d.fromInherited > 0 ? fmtMoney(d.fromInherited) : "—"}
                            </td>
                          )}
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

          </div>
          <div className="report-notes space-y-6">
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
                    conversions in low-tax years (All settings → Roth Conversions)
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
              <li>Calendar-year model: opening balances, income and withdrawals, then investment growth. Federal thresholds beyond published years use the inflation assumption; NY thresholds follow the statutory schedule.</li>
              <li>Employer-plan and IRA RMDs are satisfied separately for each owner. The Uniform Lifetime Table is used; a sole-beneficiary spouse more than ten years younger requires separate tax review.</li>
              <li>Cash interest and explicit taxable brokerage income enter income tax, Social Security taxation, NIIT, ACA, and IRMAA. Ordinary yield is included in total return and reinvested basis. With no explicit yield, taxable tax drag remains an approximation.</li>
              <li>IRMAA uses entered historical MAGI or projected two-year history. Missing history is flagged. ACA uses confirmed eligibility and entered enrollment and benchmark premiums; inconsistent subsidy calculations fall back to an explicitly unsubsidized estimate.</li>
              <li>Roth IRA qualification and conversion clocks are separate. Employer Roth assets stay separate. Mandatory catch-ups depend on prior employer wages and plan availability.</li>
              <li>HSA tax-free withdrawals require classified eligible expenses. Nonmedical withdrawals after 65 are ordinary taxable income. Ordinary insurance and Medigap premiums are not automatically eligible.</li>
              <li>Social Security includes the earnings test and benefit adjustment. Without monthly wages, first-year and FRA-year results use evenly allocated annual wages.</li>
              <li>The base couple scenario assumes both live through the horizon. Optional death scenarios prorate income, apply survivor elections, and change filing status. Spousal own-account transfers occur at the next year boundary; other inheritance elections require professional review.</li>
              <li>SEPP is restricted to its separately allocated account. Existing payment history and any recapture tax or interest must be supplied. Return assumptions, future law, long-term care costs, and individual tax-return details require independent review.</li>
              <li>This is a planning model, not a certification of sustainable income. Review material results with a qualified financial or tax professional.</li>
            </ul>
          </div>

          {/* Settings Export — collapsible section for copy/paste */}
          <div id="settings-export"><SettingsExport inputs={displayInputs} sourceInputs={inputs} /></div>
          </div>
          </div>

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
              inputs={mcResults && mcInputsRef.current ? getDisplayInputs(mcInputsRef.current) : displayInputs}
              results={mcResults && mcInputsRef.current ? simulatePlan(mcInputsRef.current) : results}
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
        open={chatOpen}
        onOpenChange={setChatOpen}
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
          adjust(s.portfolioAtEnd, s.endYear),
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
                        const val = adjust(s.portfolioAtEnd, s.endYear);
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
  open = true,
  onOpenChange,
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
  const collapsed = !open;
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
    <div className={`${shellClass} ${collapsed ? "hidden" : ""}`}>
      <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-900">Ask AI About This Plan</h2>
          {floating && (
            <button
              type="button"
              onClick={() => onOpenChange?.(!open)}
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
  showRealDollars,
  setShowRealDollars,
}) {
  const firstYear = results.yearlyData[0]?.year ?? PROJECTION_START_YEAR;
  const endYear = results.yearlyData.at(-1)?.year ?? firstYear;
  const adjustRisk = (value, year) => showRealDollars ? value / Math.pow(1 + inputs.inflation, year - firstYear) : value;
  const chartData = mcResults
    ? mcResults.percentiles.map((p, index) => ({
        age: p.age,
        "10th %ile (bad)": Math.round(adjustRisk(p.p10, results.yearlyData[index]?.year ?? firstYear + index)),
        "25th %ile": Math.round(adjustRisk(p.p25, results.yearlyData[index]?.year ?? firstYear + index)),
        "50th %ile (median)": Math.round(adjustRisk(p.p50, results.yearlyData[index]?.year ?? firstYear + index)),
        "75th %ile": Math.round(adjustRisk(p.p75, results.yearlyData[index]?.year ?? firstYear + index)),
        "90th %ile (great)": Math.round(adjustRisk(p.p90, results.yearlyData[index]?.year ?? firstYear + index)),
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
                . Both are adjustable in All settings under "Risk Assumptions" — roughly 9-11% suits a balanced target-date-style mix, ~15% all equities.
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
                  adjustRisk(
                    mcResults.finalP50,
                    endYear,
                  ),
                )}
                sublabel="50th percentile outcome"
              />
              <MetricCard
                label="Worst-Case (10th %ile)"
                value={fmtMoney(
                  adjustRisk(
                    mcResults.finalP10,
                    endYear,
                  ),
                )}
                sublabel="Bottom 10% of runs"
                tone={mcResults.finalP10 > 0 ? "neutral" : "bad"}
              />
              <MetricCard
                label="Best-Case (90th %ile)"
                value={fmtMoney(
                  adjustRisk(
                    mcResults.finalP90,
                    endYear,
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
                  Each factor above is based on the inputs used for this simulation. Adjust
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
