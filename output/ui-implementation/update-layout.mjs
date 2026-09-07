import fs from 'node:fs';
const path='src/App.jsx';
let s=fs.readFileSync(path,'utf8').replaceAll('\r\n','\n');
function change(a,b){if(!s.includes(a))throw new Error('Missing anchor: '+a.slice(0,100));s=s.replace(a,b);}
function between(a,b,newText){const i=s.indexOf(a),j=s.indexOf(b,i);if(i<0||j<0)throw new Error('Missing block');s=s.slice(0,i)+newText+s.slice(j);}
change('import FinancialDetails from "./FinancialDetails.jsx";',`import FinancialDetails from "./FinancialDetails.jsx";
import { NumericField, WorkspaceNav, ScenarioDialog, SettingsWorkspace, BaselineControls, ExploreDetails, YearInspector, CompactMetric } from './ui/PlannerWorkspace.jsx';
import { captureBaseline, baselineSeries, compareBaseline } from './ui/planComparison.js';`);
change('useEffect, useRef }','useEffect, useRef, useId }');
// Stable labels and controlled numeric drafts.
change('function NumberInput({ label, value, onChange, prefix, suffix, step = 1, hint, info }) {','function NumberInput({ label, value, onChange, prefix, suffix, step = 1, hint, info }) {\n  const id = useId();');
let start=s.indexOf('function NumberInput'),end=s.indexOf('function PctInput',start);
let fields=s.slice(start,end).replaceAll('<label className=', '<label htmlFor={id} className=');
fields=fields.replace('<input\n          type="number"','<NumericField\n          id={id}\n          aria-describedby={hint ? `${id}-hint` : undefined}');
fields=fields.replace(`onChange={(e) => {
            const n = Number(e.target.value);
            if (!isNaN(n)) onChange(n);
          }}`, 'onValue={onChange}');
fields=fields.replace('function TextInput({ label, value, onChange, hint }) {','function TextInput({ label, value, onChange, hint }) {\n  const id = useId();');
fields=fields.replace('<input\n        type="text"','<input\n        id={id}\n        aria-describedby={hint ? `${id}-hint` : undefined}\n        type="text"');
fields=fields.replaceAll('{hint && <p className=', '{hint && <p id={`${id}-hint`} className=');
s=s.slice(0,start)+fields+s.slice(end);
start=s.indexOf('function SelectInput');end=s.indexOf('function Section',start);
fields=s.slice(start,end).replace('  return (','  const id = useId();\n  return (').replace('<label className=','<label htmlFor={id} className=').replace('<select\n','<select\n        id={id}\n        aria-describedby={hint ? `${id}-hint` : undefined}\n').replace('{hint && <p className=','{hint && <p id={`${id}-hint`} className=');
s=s.slice(0,start)+fields+s.slice(end);
// Accessible term help retains all existing copy, including in section headings.
change('title={text}\n      aria-hidden="true"','title={text}\n      role="button"\n      tabIndex={0}\n      aria-label={text}\n      aria-expanded={isOpen}\n      onFocus={() => setIsOpen(true)}\n      onBlur={() => setIsOpen(false)}\n      onKeyDown={event => { if (["Enter", " ", "Escape"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); setIsOpen(event.key === "Escape" ? false : !isOpen); } }}');
change('  const [open, setOpen] = useState(defaultOpen);','  const [open, setOpen] = useState(defaultOpen);\n  const sectionId = useId();');
change('<div className={styles.wrapper}>','<section id={sectionId} data-settings-title={title} className={`settings-section ${styles.wrapper}`}>');
change('onClick={() => setOpen(!open)}\n        className={styles.button}', 'onClick={() => setOpen(!open)}\n        data-section-toggle\n        aria-expanded={open}\n        aria-controls={`${sectionId}-body`}\n        className={styles.button}');
change('{open && <div className={styles.body}>{children}</div>}\n    </div>', '<div id={`${sectionId}-body`} hidden={!open} className={`section-body ${styles.body}`}>{children}</div>\n    </section>');
// Import dialog: Escape and focus trapping/restoration.
change('  if (!open) return null;\n\n  const handleLoad',`  const importRef = useRef(null);
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

  const handleLoad`);
change('      role="dialog"\n      aria-modal="true"', '      ref={importRef}\n      role="dialog"\n      aria-modal="true"');
// Quick controls: precise number fields and clear units.
change('  const display = isPercent ?', '  const id = useId();\n  const display = isPercent ?');
change('<label className="text-xs font-medium text-slate-600">{label}</label>', '<label htmlFor={id} className="text-xs font-medium text-slate-600">{label}</label>');
change('<input\n            type="number"\n            value={display}', '<NumericField\n            id={id}\n            value={display}');
change('onChange={(e) => emit(Number(e.target.value))}', 'onValue={emit}');
change('function KeyLevers({ inputs, isCouple, update, updateCouple })', 'function KeyLevers({ inputs, isCouple, update, updateCouple, onSettings })');
change('className="bg-white rounded-lg border border-indigo-300 shadow-sm mb-4 lg:sticky lg:top-0 lg:z-20 overflow-hidden"', 'className="quick-controls"');
change('onClick={toggle}\n        className=', 'onClick={toggle}\n        aria-expanded={open}\n        className=');
change('<span className="text-base leading-none">🎚️</span>', '<span className="live-dot" aria-hidden="true" />');
change('            Key levers\n','            Adjust your plan\n');
change('The inputs that move the plan most — drag and watch the results react.\n        Everything else is in the sections below.', 'Change an assumption and see the graph update.');
const leverStart=s.indexOf('function KeyLevers'),leverEnd=s.indexOf('function CashStrategyInputs',leverStart);
let levers=s.slice(leverStart,leverEnd).replaceAll('step={5000}','step={500}').replaceAll('step={0.25}','step={0.1}').replace('label="Spending / yr"','label="Lifestyle spending / year"').replace('label="SS claim age"','label="Social Security claim age"').replace('label="Retire at age"','label="Retirement age"');
levers=levers.replace('      </div>\n      )}',`      <p className="muted">Spending is in today's dollars and excludes healthcare.</p>
      <button className="text-action" onClick={onSettings}>All settings →</button>
      <p className="muted">Accounts, income, taxes and advanced rules.</p>
      </div>
      )}`);
s=s.slice(0,leverStart)+levers+s.slice(leverEnd);
// App state and navigation remain independent of the financial model.
change('  const [activeTab, setActiveTab] = useState("plan");',`  const [activeTab, setActiveTab] = useState("plan");
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
  }, []);`);
// remove obsolete scrolling metrics overlay; persistent navigation replaces it.
between('  // Slim fixed results bar appears', '  const [mcRunning', '');
change('  const results = useMemo(() => simulatePlan(inputs), [inputs]);',`  const results = useMemo(() => simulatePlan(inputs), [inputs]);
  const baseline = useMemo(() => ({inputs: baselineInputs, results: simulatePlan(baselineInputs)}), [baselineInputs]);
  const comparison = useMemo(() => compareBaseline(baseline, inputs, results), [baseline, inputs, results]);`);
change('setInputs(normalizeInputs(active.inputs));', 'setInputs(normalizeInputs(active.inputs));\n        setBaselineInputs(captureBaseline(normalizeInputs(active.inputs)));');
change('    setSaveStatus(ok ? status : "idle");', '    setSaveStatus(ok ? status : "idle");\n    setSaveError(ok ? "" : "Could not save in this browser. Export your settings to keep a copy.");');
between('    const name = (window.prompt("Name this scenario:", suggested)', '  // Switch to a saved scenario',`    setScenarioRequest({kind: 'new', initial: suggested});
  };

  const submitScenarioName = async name => {
    if (scenarioRequest.kind === 'rename' && activeScenario) {
      await persistStore(savedScenarios.map(item => item.id === activeScenario.id ? {...item,name} : item), activeScenario.id);
    } else {
      const scenario = { id: makeScenarioId(), name, inputs: captureBaseline(inputs), savedAt: Date.now() };
      await persistStore([...savedScenarios, scenario], scenario.id);
    }
    setScenarioRequest(null);
  };

`);
change('    setInputs(normalizeInputs(scenario.inputs));', '    setInputs(normalizeInputs(scenario.inputs));\n    setBaselineInputs(captureBaseline(normalizeInputs(scenario.inputs)));');
between('  const handleRenameScenario = async () => {','  const handleDeleteScenario',`  const handleRenameScenario = () => {
    if (activeScenario) setScenarioRequest({kind:'rename', initial:activeScenario.name});
  };

`);
change('    setInputs(normalizeInputs(DEFAULT_INPUTS));', '    setInputs(normalizeInputs(DEFAULT_INPUTS));\n    setBaselineInputs(captureBaseline(normalizeInputs(DEFAULT_INPUTS)));');
change('  const currentYear = PROJECTION_START_YEAR;', '  const currentYear = results.yearlyData[0]?.year ?? PROJECTION_START_YEAR;');
// Map both graphs through the same display-dollar conversion as the table.
change('  const chartData = results.yearlyData.map((d) => ({','  const baselineValues = baselineSeries(baseline, results.yearlyData, showRealDollars);\n  const chartData = results.yearlyData.map((raw, index) => { const d = adjustRow(raw); return ({');
change('    ...d,\n    age: d.age,','    ...d,\n    Baseline: baselineValues[index],\n    age: d.age,');
change('  }));\n\n  const flowData', '  }); });\n\n  const flowData');
change('    .map((d) => ({\n      ...d,','    .map((raw) => { const d = adjustRow(raw); return ({\n      ...d,');
change('    }));\n  const chartAxisTicks', '    }); });\n  const chartAxisTicks');
change('const chartAxisTicks = buildReadableAxisTicks(chartData, isCouple ? 10 : 12);','const chartAxisTicks = buildReadableAxisTicks(chartData, isCouple ? 7 : 8);');
// Shared header, navigation and status.
between('      {/* Slim live results bar', '      {/* Print-specific styles */}', '');
between('      <header', '      {/* Load-from-text modal', `      <header className="planner-header print:hidden">
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
            <button onClick={() => { navigate('years'); requestAnimationFrame(() => document.getElementById('settings-export')?.scrollIntoView()); }}>Export settings</button>
            <button onClick={() => window.print()}>Save as PDF</button>
            <button onClick={reset}>Reset to defaults</button>
          </div></details>
        </div>
      </header>
      <div className="navigation-row print:hidden"><WorkspaceNav active={activeTab} onNavigate={navigate} />
        <button className="assistant-launch" aria-expanded={chatOpen} onClick={() => setChatOpen(!chatOpen)}>Ask about this plan</button></div>
      {scenarioRequest && <ScenarioDialog request={scenarioRequest} onSubmit={submitScenarioName} onClose={() => setScenarioRequest(null)} />}
      {saveError && <p role="alert" className="save-error">{saveError}</p>}

`);
between('      {/* Metrics strip */}', '      {/* Main layout */}', `      <div className="dashboard-overview">
        <div className="overview-heading"><h2 ref={workspaceRef} tabIndex={-1}>{activeTab === 'plan' ? 'Your retirement outlook' : activeTab === 'settings' ? 'Plan assumptions' : activeTab === 'years' ? 'Year-by-year breakdown' : activeTab === 'compare' ? 'Compare retirement and spending' : 'Risk analysis'}</h2>
          <div className="dollar-switch" role="group" aria-label="Display dollars"><button aria-pressed={!showRealDollars} onClick={() => setShowRealDollars(false)}>Future dollars</button><button aria-pressed={showRealDollars} onClick={() => setShowRealDollars(true)}>Today's dollars</button></div></div>
        <div className="overview-row"><div className="overview-metrics">
          <CompactMetric label={'Portfolio at age '+retirementDisplayAge} value={fmtMoney(adjust(s.portfolioAtRetirement,currentYear+retirementDisplayAge-displayInputs.currentAge))} tone="positive" detail={'End of the first projected retirement year. Current portfolio: '+fmtMoney(s.currentTotal)+'. Values use the selected dollar basis.'} />
          <CompactMetric label={'Portfolio at age '+displayInputs.planThroughAge} value={fmtMoney(adjust(s.portfolioAtEnd,currentYear+displayInputs.planThroughAge-displayInputs.currentAge))} tone={s.portfolioAtEnd <= 0 ? 'negative' : ''} detail="End-of-plan account balances. A positive balance alone does not rule out an earlier cash-flow shortfall; review the plan status." />
          <CompactMetric label="First-year withdrawal" value={fmtPct(s.year1WithdrawalRate)} tone="caution" detail={'Includes withdrawals to fund taxes. Compare with the '+fmtPct(shortfall.guideline)+' guideline for this '+shortfall.retirementYears+'-year retirement.'} />
          <CompactMetric label="Total Roth converted" value={fmtMoney(s.totalConverted)} detail={'Total transferred over the plan, in future dollars. Lifetime taxes: '+fmtMoney(s.totalTaxesPaid)+'. These sums are not today’s purchasing power.'} />
        </div><div className="overview-notices">
          <div className={'compact-health '+(s.calculationValid === false || shortfall.status === 'danger' ? 'danger' : shortfall.status === 'warning' ? 'caution' : 'funded')}>
            <strong>{s.calculationValid === false ? 'Calculation needs review' : shortfall.status === 'danger' ? 'Projected shortfall at age '+(shortfall.firstShortfallAge ?? '—')+(isCouple ? ' (primary)' : '') : shortfall.status === 'warning' ? 'Plan funded with a thin margin' : 'Plan funded through age '+displayInputs.planThroughAge}</strong>
            <button onClick={() => { setSelectedYear(results.yearlyData.find(row => row.age === shortfall.firstShortfallAge)?.year ?? null); navigate('years'); }}>View years →</button>
          </div>
          {s.modelNotices?.length > 0 && <details className="compact-notices"><summary>{s.modelNotices.length} financial details need review</summary><div><p>Estimates remain provisional. Sustainable spending is withheld while material inputs are unresolved.</p><ul>{s.modelNotices.map(notice => <li key={notice}>{notice}</li>)}</ul></div></details>}
          {s.modelNotices?.length > 0 && <button className="review-link" onClick={() => navigate('history')}>Review financial details →</button>}
        </div></div>
      </div>

`);
// Separate full settings from the dashboard; preserve the original form intact.
change('<div className="max-w-[1800px] mx-auto grid grid-cols-1 lg:grid-cols-16 gap-6 p-6 print:p-0 print:gap-2">', '<div className={`planner-workspace workspace-${activeTab}`}>');
between('        <aside className=', '          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">', `        <aside className="quick-sidebar print:hidden">
          <KeyLevers inputs={inputs} isCouple={isCouple} update={update} updateCouple={updateCouple} onSettings={() => navigate('settings')} />
          <BaselineControls comparison={comparison} onCapture={() => setBaselineInputs(captureBaseline(inputs))} onRestore={() => { setInputs(captureBaseline(baselineInputs)); setMcResults(null); }} />
        </aside>
        <div className={activeTab === 'settings' ? 'settings-view print:hidden' : 'settings-view hidden print:hidden'}>
        <SettingsWorkspace scope={isCouple ? 'couple' : 'individual'} historyRequest={historyRequest} notices={s.modelNotices}>
`);
change('              Your Inputs\n', '              Household and filing status\n');
// Locate end of the former form sidebar.
change('        </aside>\n\n        {/* Results area */}', '        </SettingsWorkspace>\n        </div>\n\n        {/* Results area */}');
between('        <main className=', '          {/* Portfolio composition chart */}', `        <main className="workspace-main min-w-0 space-y-6 print:space-y-3">
          <div className={activeTab === 'plan' || activeTab === 'years' ? 'plan-report space-y-6' : 'plan-report hidden print:block'}>
          <div className="dashboard-charts space-y-6">
`);
change('                  Portfolio Composition Over Time','                  Portfolio over time');
// Long chart explanation retained in a disclosure.
change('<p className="text-xs text-slate-500 mt-0.5">\n                  Watch how each account', '<details className="chart-explainer"><summary>Account composition, withdrawals and baseline</summary><p className="text-xs text-slate-500 mt-0.5">\n                  Watch how each account');
change('badge in the year-by-year table.\n                </p>', 'badge in the year-by-year table. The dotted baseline follows the same calendar years; missing years are not extrapolated.\n                </p></details>');
change('              <ComposedChart data={chartData}>','              <ComposedChart data={chartData} accessibilityLayer>');
change('                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />', '                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />\n                <Line type="monotone" dataKey="Baseline" stroke="#4f46e5" strokeWidth={2} strokeDasharray="4 4" dot={false} connectNulls={false} isAnimationActive={false} />');
// Details links immediately beneath chart before lower-priority long-form content.
change('          {/* Annual cash flow chart */}',`          <ExploreDetails onNavigate={navigate} noticeCount={s.modelNotices?.length || 0} />
          {/* Annual cash flow chart */}`);
const phaseMarker='          {/* Retirement phase explainer */}';
// Determine actual existing phase comment before wrapping long explanations.
const phaseIndex=s.indexOf('                  Your Retirement Phases Explained');
const actualPhase=s.lastIndexOf('          {/*',phaseIndex>0?phaseIndex:s.indexOf('Your Retirement Phases Explained'));
if(actualPhase<0)throw new Error('phase anchor');
s=s.slice(0,actualPhase)+`          </div>
          <details className="plan-explanation"><summary>Plan explanation, retirement phases and withdrawal strategy</summary>
          <div className="space-y-6 explanation-body">
          <PlanStatusBanner shortfall={shortfall} calculationValid={s.calculationValid} planThroughAge={displayInputs.planThroughAge} isCouple={isCouple} maxSustainableSpending={maxSustainableSpending} plannedSpending={displayInputs.baseExpenses} />
          <PlanNarrative narrative={planNarrative} />
`+s.slice(actualPhase);
change('          {/* Year-by-year table */}', `          </div></details>
          <div className="year-workspace space-y-6">
          <YearInspector row={results.yearlyData.find(row => row.year === selectedYear) ?? results.yearlyData.find(row => row.phase !== 'accumulation') ?? results.yearlyData[0]} rows={results.yearlyData} onSelect={setSelectedYear} real={showRealDollars} inflation={displayInputs.inflation} firstYear={currentYear}>
            {isCouple && <CoupleOwnerDetailGrid ownerDetails={adjustRow(results.yearlyData.find(row => row.year === selectedYear) ?? results.yearlyData.find(row => row.phase !== 'accumulation') ?? results.yearlyData[0]).ownerDetails} />}
          </YearInspector>
          {/* Year-by-year table */}`);
change('<div className="overflow-auto max-h-[600px] print:max-h-none print:overflow-visible">', '<div className="year-table-scroll overflow-auto max-h-[600px] print:max-h-none print:overflow-visible" role="region" aria-label="Year-by-year projection table" tabIndex={0}>');
change('<td className="px-3 py-1.5 font-semibold">\n                            {isCouple', '<td className="year-identity px-3 py-1.5 font-semibold"><button aria-label={`Inspect year ${d.year}`} onClick={() => { setSelectedYear(d.year); document.querySelector(\'.year-inspector\')?.scrollIntoView({block:\'start\'}); }}>\n                            {isCouple');
change('                              : d.age}\n                          </td>', '                              : d.age}</button>\n                          </td>');
change('          {/* Explaining the ending balance', '          </div>\n          <div className="report-notes space-y-6">\n          {/* Explaining the ending balance');
change('<SettingsExport inputs={displayInputs} sourceInputs={inputs} />\n            </>\n          )}', '<div id="settings-export"><SettingsExport inputs={displayInputs} sourceInputs={inputs} /></div>\n          </div>\n          </div>');
// Keep risk diagnosis and plots anchored to the actual completed run.
change('              inputs={displayInputs}\n              results={results}\n              mcResults={mcResults}', '              inputs={mcResults && mcInputsRef.current ? getDisplayInputs(mcInputsRef.current) : displayInputs}\n              results={mcResults && mcInputsRef.current ? simulatePlan(mcInputsRef.current) : results}\n              mcResults={mcResults}');
change('        floating\n      />', '        floating\n        open={chatOpen}\n        onOpenChange={setChatOpen}\n      />');
change('  floating = false,\n})', '  floating = false,\n  open = true,\n  onOpenChange,\n})');
change('  const [collapsed, setCollapsed] = useState(false);', '  const collapsed = !open;');
change('    <div className={shellClass}>', '    <div className={`${shellClass} ${collapsed ? "hidden" : ""}`}>');
change('onClick={() => setCollapsed((value) => !value)}', 'onClick={() => onOpenChange?.(!open)}');
// Print classes and root scope.
change('<div className="min-h-screen bg-slate-50 text-slate-900">','<div className="planner-app min-h-screen bg-slate-50 text-slate-900">');
fs.writeFileSync(path,s);
