import { useEffect, useId, useRef, useState } from 'react';
import { fmtMoneyFull } from '../finance/engine.js';

export function NumericField({ value, onValue, nullable = false, ...props }) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  return <input {...props} type="number" value={draft}
    onChange={event => {
      const text = event.target.value;
      setDraft(text);
      if (text !== '' && Number.isFinite(Number(text))) onValue(Number(text));
    }}
    onBlur={() => {
      if (draft === '' && nullable) onValue(null);
      else setDraft(value ?? '');
    }} />;
}

export function WorkspaceNav({ active, onNavigate }) {
  return <nav className="workspace-nav" aria-label="Planner workspaces">
    {[
      ['plan', 'Dashboard'], ['settings', 'All settings'], ['years', 'Year-by-year'],
      ['compare', 'Compare'], ['risk', 'Risk analysis'],
    ].map(([key, label]) => <button key={key} aria-current={active === key ? 'page' : undefined}
      className={active === key ? 'selected' : ''} onClick={() => onNavigate(key)}>{label}</button>)}
  </nav>;
}

export function ScenarioDialog({ request, onSubmit, onClose }) {
  const ref = useRef(null);
  const id = useId();
  const [name, setName] = useState(request.initial || '');
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => previous?.focus();
  }, []);
  return <dialog ref={ref} className="workspace-dialog" aria-labelledby={id}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); if (name.trim()) onSubmit(name.trim()); }}>
      <h2 id={id}>{request.kind === 'delete' ? 'Delete saved scenario?' : request.kind === 'rename' ? 'Rename scenario' : 'Save a new scenario'}</h2>
      <p>{request.kind === 'delete' ? `Delete “${request.initial}” from this browser? This cannot be undone. Export settings first if you need a copy.` : 'Keep this complete set of assumptions in this browser.'}</p>
      {request.kind !== 'delete' && <><label htmlFor={`${id}-name`}>Scenario name</label>
      <input id={`${id}-name`} autoFocus value={name} maxLength={100} onChange={event => setName(event.target.value)} /></>}
      <div className="dialog-actions"><button autoFocus={request.kind === 'delete'} type="button" onClick={onClose}>Cancel</button>
        <button className="primary-action" disabled={!name.trim()}>{request.kind === 'delete' ? 'Delete scenario' : 'Save scenario'}</button></div>
    </form>
  </dialog>;
}

export function BaselineControls({ comparison, onCapture, onRestore }) {
  let timing = 'No shortfall in either projection';
  if (comparison) {
    const { beforeShortfall: before, afterShortfall: after } = comparison;
    if (before && after) timing = before === after ? 'Same first shortfall year'
      : `First shortfall ${Math.abs(after - before)} year${Math.abs(after - before) === 1 ? '' : 's'} ${after < before ? 'earlier' : 'later'}`;
    else if (after) timing = `New shortfall in ${after}`;
    else if (before) timing = 'Projected shortfall removed';
  }
  const signed = value => `${value > 0 ? '+' : value < 0 ? '−' : ''}${fmtMoneyFull(Math.abs(value))}`;
  return <section className="baseline-controls" aria-label="Baseline comparison">
    <div className="baseline-heading"><strong>Compared with baseline</strong>
      <span>{comparison?.changed ? 'Working changes' : 'No changes'}</span></div>
    <p>{comparison?.changed ? `${signed(comparison.spending)} / year lifestyle spending` : 'Adjust an assumption to explore a different outcome.'}</p>
    {comparison?.changed && <p>{timing}{comparison.ending !== null ? ` · Ending portfolio change ${signed(comparison.ending)} (future dollars)` : ' · Plan horizons differ'}</p>}
    <div className="baseline-actions"><button onClick={onRestore} disabled={!comparison?.changed}>Restore baseline</button>
      <button onClick={onCapture}>Set current as baseline</button></div>
    <p className="muted">Baseline is temporary. Save a scenario to keep it.</p>
  </section>;
}

export function ExploreDetails({ onNavigate, noticeCount }) {
  return <section className="explore-details">
    <h2>Explore the details</h2>
    {[
      ['years', 'Year-by-year breakdown', 'Income, tax, withdrawals and account balances'],
      ['history', 'Tax and account history', noticeCount ? `Review ${noticeCount} financial notices` : 'Eligibility, account rules and historical inputs'],
      ['risk', 'Risk analysis', 'Run 500 market simulations'],
    ].map(([key, label, description]) => <button key={key} aria-label={label} onClick={() => onNavigate(key)}>
      <span><strong>{label}</strong><small>{description}</small></span><span aria-hidden="true">→</span>
    </button>)}
  </section>;
}

function revealSection(element) {
  const ancestors = [];
  for (let parent = element; parent; parent = parent.parentElement) {
    if (parent.matches('[data-settings-title]')) ancestors.unshift(parent);
    if (parent.tagName === 'DETAILS') parent.open = true;
  }
  ancestors.forEach(parent => {
    const toggle = parent.querySelector(':scope > button[data-section-toggle]');
    if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click();
  });
  requestAnimationFrame(() => {
    element.scrollIntoView({ block: 'start' });
    element.querySelector(':scope > button, :scope > summary')?.focus({ preventScroll: true });
  });
}

export function SettingsWorkspace({ children, scope, historyRequest, notices = [] }) {
  const root = useRef(null);
  const [sections, setSections] = useState([]);
  useEffect(() => {
    const elements = [...root.current.querySelectorAll('[data-settings-title]')];
    setSections(elements.map((element, index) => ({ element, index, title: element.dataset.settingsTitle })));
    if (historyRequest) {
      const history = elements.filter(element => element.classList.contains('financial-details'));
      history.forEach(element => revealSection(element));
      if (history[0]) requestAnimationFrame(() => revealSection(history[0]));
    }
  }, [scope, historyRequest]);
  return <section className="settings-workspace" aria-label="All plan settings">
    <div className="settings-heading"><h2>All settings</h2><p>Every assumption, in one place. Changes update your active scenario.</p></div>
    <nav className="settings-index" aria-label="Settings sections">
      <strong>Jump to a section</strong>
      {sections.map(section => <button key={section.index} onClick={() => revealSection(section.element)}>{section.title}</button>)}
    </nav>
    <div ref={root} className="settings-editor">
      {notices.length > 0 && <div className="settings-notices"><strong>Financial details to review</strong><ul>{notices.map(notice => <li key={notice}>{notice}</li>)}</ul></div>}
      {children}
    </div>
  </section>;
}

const YEAR_GROUPS = [
  ['Income and spending', [['wages','Salary'],['partTimeGross','Part-time gross pay'],['partTime','Part-time spendable income'],['ss','Social Security'],['pension','Pension'],['spending','Spending'],['tax','Income taxes and penalties'],['ficaTax','Employee payroll tax'],['unmetCashFlow','Unfunded need']]],
  ['Withdrawals and transfers', [['fromCash','Cash'],['fromTaxable','Taxable brokerage'],['from401k','Employer plan'],['fromIra','Traditional IRA (including SEPP)'],['fromRoth','Roth accounts'],['fromRoth401k','Included employer Roth'],['fromInherited','Inherited account'],['hsaWithdrawal','HSA'],['seppIncome','Included SEPP income'],['conversion','Roth conversion (transfer)'],['surplusToCash','Surplus saved to cash']]],
  ['Tax detail', [['magi','Modified adjusted gross income'],['taxableSs','Taxable Social Security'],['realizedGain','Realized capital gains'],['rmdAmount','Required distributions'],['inheritedRmdAmount','Inherited required distribution'],['taxableHsaWithdrawal','Taxable HSA withdrawal'],['irmaaSurcharge','IRMAA surcharge'],['acaSubsidy','ACA subsidy'],['earlyPenalty','Early withdrawal penalty']]],
  ['End-of-year accounts', [['cash','Cash'],['taxable','Taxable brokerage'],['k401','Employer plan'],['tradIra','Traditional IRA (including SEPP)'],['roth','Roth accounts'],['roth401k','Included employer Roth'],['hsa','HSA'],['inherited','Inherited account'],['seppBalance','Included SEPP account'],['total','Total portfolio']]],
];

export function YearInspector({ row, rows, onSelect, real, inflation, firstYear, children }) {
  if (!row) return null;
  const factor = real ? Math.pow(1 + inflation, row.year - firstYear) : 1;
  const index = rows.findIndex(item => item.year === row.year);
  return <section className="year-inspector" aria-label="Selected year breakdown">
    <div className="year-inspector-heading"><div><h2>{row.year} in detail</h2><p>Age {row.age}{row.spouseAge != null ? ` · Spouse age ${row.spouseAge}` : ''} · {real ? "Today's dollars" : 'Future dollars'}</p></div>
      <div className="year-picker"><button disabled={index === 0} onClick={() => onSelect(rows[index-1].year)}>Previous year</button>
        <label>Year<select value={row.year} onChange={event => onSelect(Number(event.target.value))}>{rows.map(item => <option key={item.year} value={item.year}>{item.year} · Age {item.age}</option>)}</select></label>
        <button disabled={index === rows.length-1} onClick={() => onSelect(rows[index+1].year)}>Next year</button></div></div>
    {row.calculationNotice && <p role="status">{row.calculationNotice}</p>}
    <div className="year-groups">{YEAR_GROUPS.map(([title, fields]) => <section key={title}><h3>{title}</h3><dl>{fields.filter(([key]) => row[key] !== undefined).map(([key,label]) => <div key={key}><dt>{label}</dt><dd>{fmtMoneyFull(row[key] / factor)}</dd></div>)}</dl></section>)}</div>
    {children}
    <details className="raw-year"><summary>All calculated fields for this year</summary><p>Unadjusted engine output in future dollars; includes flags and per-owner detail.</p><pre>{JSON.stringify(row,null,2)}</pre></details>
    <p className="muted">Roth conversions transfer assets between accounts; they are not spending withdrawals. Employer Roth is included in the Roth total, and SEPP is included in the traditional IRA total. These breakdowns and tax components must not be added twice.</p>
  </section>;
}

export function CompactMetric({ label, value, detail, tone }) {
  return <div className={`compact-metric ${tone || ''}`}><span>{label}</span><strong>{value}</strong>
    <details><summary>How to read this</summary><p>{detail}</p></details></div>;
}
