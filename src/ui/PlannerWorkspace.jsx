import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fmtMoneyFull } from '../finance/engine.js';
import { buildReviewItems } from './reviewModel.js';
import { ReviewContext } from './ReviewContext.js';

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

const NAV_GROUPS = [
  ['Your plan', [['settings', 'Your information']]],
  ['Results', [['plan', 'Overview'], ['years', 'Year by year']]],
  ['Explore', [['compare', 'Compare plans'], ['risk', 'Risk analysis']]],
];

export function WorkspaceNav({ active, onNavigate, reviewCount = 0, onAssistant, assistantOpen, settingsIndexRef }) {
  const [sectionsExpanded, setSectionsExpanded] = useState(true);
  const sectionsId = useId();
  useEffect(() => {
    if (active === 'settings') setSectionsExpanded(true);
  }, [active]);
  return <nav className="workspace-nav" aria-label="Planner workspaces">
    {NAV_GROUPS.map(([title, items]) => <div className="workspace-nav-group" key={title}>
      <p className="workspace-nav-title">{title}</p>
      {items.map(([key, label]) => <div className="workspace-nav-item" key={key}>
        <div className="workspace-nav-link-row">
        <button aria-current={active === key ? 'page' : undefined}
          aria-expanded={key === 'settings' ? active === 'settings' && sectionsExpanded : undefined}
          aria-controls={key === 'settings' ? sectionsId : undefined}
          className={active === key ? 'selected' : ''} onClick={() => {
            if (key === 'settings' && active === 'settings') setSectionsExpanded(value => !value);
            else onNavigate(key);
          }}>
          <span>{label}</span>
          {key === 'settings' && reviewCount > 0 && <span className="workspace-nav-badge" aria-label={`${reviewCount} details need review`}>{reviewCount}</span>}
        </button>
        {key === 'settings' && active === 'settings' && <button className="workspace-nav-disclosure"
          aria-label={sectionsExpanded ? 'Collapse information sections' : 'Expand information sections'}
          aria-expanded={sectionsExpanded} aria-controls={sectionsId}
          onClick={() => setSectionsExpanded(value => !value)}><span aria-hidden="true">{sectionsExpanded ? '⌃' : '⌄'}</span></button>}
        </div>
        {key === 'settings' && <div id={sectionsId} ref={settingsIndexRef} className="rail-settings-slot" hidden={active !== 'settings' || !sectionsExpanded} />}
      </div>)}
      {title === 'Explore' && <button className="assistant-launch" aria-expanded={assistantOpen} onClick={onAssistant}>Ask about this plan</button>}
    </div>)}
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

export function BaselineControls({ comparison, onCapture, onRestore, simulationStatus }) {
  const modeChanged = comparison?.changes.some(change => change.path === 'mode');
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
    <p>{comparison?.changed ? 'Changes to the deterministic projection:' : 'Adjust an assumption to explore a different outcome.'}</p>
    {comparison?.changed && <>
      <ul className="baseline-changes">{comparison.changes.slice(0,modeChanged ? 1 : 2).map(change => <li key={change.path}><strong>{change.label}</strong>: {change.before} → {change.after}</li>)}</ul>
      {modeChanged && <p>Different planning modes use different input sets. The full comparison includes those newly active and inactive settings.</p>}
      {comparison.changes.length > (modeChanged ? 1 : 2) && <details><summary>{modeChanged ? 'Compare full configurations' : `All ${comparison.changes.length} changed assumptions`}</summary><ul className="baseline-changes">{comparison.changes.map(change => <li key={change.path}><strong>{change.label}</strong>: {change.before} → {change.after}</li>)}</ul></details>}
      {comparison.changes.length === 0 && <p>Only settings outside the active planning mode changed.</p>}
      <dl className="baseline-impact">
        <div><dt>First shortfall year</dt><dd>{comparison.beforeShortfall ?? 'None'} → {comparison.afterShortfall ?? 'None'}</dd></div>
        {comparison.beforeEnding !== null && comparison.afterEnding !== null ? <>
          <div><dt>Ending balance ({comparison.afterHorizon})</dt><dd>{fmtMoneyFull(comparison.beforeEnding)} → {fmtMoneyFull(comparison.afterEnding)}</dd></div>
          <div><dt>Ending balance change</dt><dd>{signed(comparison.ending)}</dd></div>
        </> : <div><dt>Plan end years differ</dt><dd>{comparison.beforeHorizon} → {comparison.afterHorizon}</dd></div>}
      </dl><p>{timing}. Ending balances use future dollars.</p>
      {comparison.provisional && <p>Comparison is provisional: review unresolved financial details.</p>}
    </>}
    {simulationStatus && <p>{simulationStatus}</p>}
    <div className="baseline-actions"><button onClick={onRestore} disabled={!comparison?.changed}>Restore baseline</button>
      <button onClick={onCapture}>Set current as baseline</button></div>
    <p className="muted">Baseline is temporary and used for comparison.</p>
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

const workspaceScrollOffset = () => {
  const header = document.querySelector('.planner-header');
  const stickyHeader = header && ['sticky', 'fixed'].includes(getComputedStyle(header).position);
  return (stickyHeader ? header.getBoundingClientRect().height : 0)
    + (document.querySelector('.save-reminder')?.getBoundingClientRect().height || 0) + 24;
};
function scrollToWorkspaceElement(element) {
  window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - workspaceScrollOffset() });
}
function revealSection(element, focusInput = false) {
  if (!element) return;
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
    scrollToWorkspaceElement(element);
    const target = focusInput ? element.querySelector('input[data-needs-review=true], select[data-needs-review=true], input, select, textarea, button, summary')
      : element.querySelector(':scope > button, :scope > summary');
    target?.focus({ preventScroll: true });
  });
}

export function SettingsWorkspace({ children, scope, historyRequest, sectionRequest, notices = [], inputs, active = true, onYear, indexTarget }) {
  const root = useRef(null);
  const reviewHeading = useRef(null);
  const [sections, setSections] = useState([]);
  const [currentSection, setCurrentSection] = useState(null);
  const reviews = useMemo(() => buildReviewItems(notices, inputs), [notices, inputs]);
  useEffect(() => {
    const elements = [...root.current.querySelectorAll('[data-settings-title]')];
    setSections(elements.map((element, index) => ({ element, index, title: element.dataset.settingsTitle })));
  }, [scope, active]);
  useEffect(() => {
    if (!active || !historyRequest) return;
    const frame = requestAnimationFrame(() => {
      if (reviewHeading.current) {
        scrollToWorkspaceElement(reviewHeading.current);
        reviewHeading.current.focus({ preventScroll: true });
      } else revealSection(root.current.querySelector('.financial-details'));
    });
    return () => cancelAnimationFrame(frame);
  }, [active, historyRequest]);
  useEffect(() => {
    if (!active || !sectionRequest) return;
    const target = sections.find(section => section.title === sectionRequest);
    if (target) revealSection(target.element);
    else if (sectionRequest === 'Risk Assumptions') {
      const label = [...root.current.querySelectorAll('label[for]')].find(element => element.textContent.trim() === 'Portfolio Volatility');
      if (label) revealSection(label.parentElement, true);
    }
  }, [active, sectionRequest, sections]);
  useEffect(() => {
    if (!active) return;
    let frame;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const visible = sections.filter(section => section.element.getClientRects().length);
        const passed = visible.filter(section => section.element.getBoundingClientRect().top <= workspaceScrollOffset() + 40);
        setCurrentSection((passed.at(-1) ?? visible[0])?.index ?? null);
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(root.current);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const element = root.current;
    element.addEventListener('toggle', update, true);
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      element.removeEventListener('toggle', update, true);
    };
  }, [active, sections]);
  const reviewTarget = target => {
    const owner = root.current.querySelector(`[data-review-owner="${target.owner}"]`);
    const field = target.fields.map(key => owner?.querySelector(`[data-review-field="${key}"]`)).find(Boolean);
    revealSection(field ?? owner, Boolean(field));
  };
  const sectionIndex = <nav className={indexTarget ? 'rail-settings-index' : 'settings-index'} aria-label="Settings sections">
      <strong>Jump to a section</strong>
      {sections.map(section => <button key={section.index} aria-current={currentSection === section.index ? 'location' : undefined} onClick={() => revealSection(section.element)}>{section.title}</button>)}
    </nav>;
  return <ReviewContext.Provider value={reviews}><section className="settings-workspace" aria-label="All plan settings">
    <div className="settings-heading"><h2>Plan assumptions</h2><p>Every assumption, in one place. Changes update your active scenario.</p></div>
    {indexTarget ? active && createPortal(sectionIndex, indexTarget) : sectionIndex}
    <div ref={root} className="settings-editor">
      {reviews.length > 0 && <div className="settings-notices"><h3 ref={reviewHeading} tabIndex={-1}>Financial details to review ({reviews.length})</h3>
        <p>Each note describes a current assumption or limitation. Reviewing a field does not confirm it automatically.</p>
        <ul className="review-list">{reviews.map(item => <li className="review-item" key={item.id}>
          <p>{item.message}</p><p><strong>Affects:</strong> {item.impact}</p>
          <div className="review-actions">{item.targets.length ? item.targets.map(target => <button type="button" key={target.owner} onClick={() => reviewTarget(target)}>
            {item.action}{target.owner !== 'individual' ? ` · ${target.owner === 'shared' ? 'Household' : target.owner === 'primary' ? 'Primary' : 'Spouse'}` : ''}
          </button>) : <button type="button" onClick={() => item.year ? onYear?.(item.year) : revealSection(root.current.querySelector('.financial-details'))}>{item.action}</button>}</div>
        </li>)}</ul></div>}
      {children}
    </div>
  </section></ReviewContext.Provider>;
}

const YEAR_GROUPS = [
  ['Income and spending', [['wages','Salary'],['partTimeGross','Part-time gross pay'],['partTime','Part-time spendable income'],['ss','Social Security'],['pension','Pension'],['spending','Spending'],['tax','Income taxes and penalties'],['ficaTax','Employee payroll tax'],['unmetCashFlow','Unfunded need']]],
  ['Withdrawals and transfers', [['fromCash','Cash'],['fromTaxable','Taxable brokerage'],['from401k','Employer plan'],['fromIra','Traditional IRA (including SEPP)'],['fromRoth','Roth accounts'],['fromRoth401k','Included employer Roth'],['fromInherited','Inherited account'],['hsaWithdrawal','HSA'],['seppIncome','Included SEPP income'],['conversion','Roth conversion (transfer)'],['surplusToCash','Surplus saved to cash']]],
  ['Tax detail', [['magi','Modified adjusted gross income'],['taxableSs','Taxable Social Security'],['realizedGain','Realized capital gains'],['rmdAmount','Required distributions'],['inheritedRmdAmount','Inherited required distribution'],['taxableHsaWithdrawal','Taxable HSA withdrawal'],['irmaaSurcharge','IRMAA surcharge'],['acaSubsidy','ACA subsidy'],['earlyPenalty','Early withdrawal penalty']]],
  ['End-of-year accounts', [['cash','Cash'],['taxable','Taxable brokerage'],['k401','Employer plan'],['tradIra','Traditional IRA (including SEPP)'],['roth','Roth accounts'],['roth401k','Included employer Roth'],['hsa','HSA'],['inherited','Inherited account'],['seppBalance','Included SEPP account'],['total','Total portfolio']]],
];

export function YearInspector({ row, rows, onSelect, real, inflation, firstYear, children }) {
  const [showZeros, setShowZeros] = useState(true);
  if (!row) return null;
  const factor = real ? Math.pow(1 + inflation, row.year - firstYear) : 1;
  const index = rows.findIndex(item => item.year === row.year);
  const withdrawalKeys = ['fromCash', 'fromTaxable', 'from401k', 'fromIra', 'fromRoth', 'fromInherited', 'hsaWithdrawal'];
  const withdrawals = withdrawalKeys.some(key => row[key] !== undefined)
    ? withdrawalKeys.reduce((sum, key) => sum + (row[key] ?? 0), 0) : undefined;
  const summary = [
    ['Spending', row.spending], ['Income taxes and penalties', row.tax],
    ['Account withdrawals', withdrawals], ['Modified adjusted gross income', row.magi],
    ['Portfolio at year end', row.total, 'portfolio'],
    ...(row.unmetCashFlow > 0 ? [['Unfunded need', row.unmetCashFlow, 'shortfall']] : []),
  ];
  const descriptions = ['Income and annual costs.', 'Account withdrawals and transfers.', 'Income measures, taxes and surcharges.', 'Balances after withdrawals, transfers and growth.'];
  const renderFields = fields => <><dl>{fields.filter(([key]) => row[key] !== undefined).map(([key, label]) => {
    const isZero = row[key] === 0;
    const included = label.startsWith('Included ');
    return <div key={key} hidden={!showZeros && isZero && key !== 'total' && key !== 'unmetCashFlow'}
      className={`year-value${isZero ? ' is-zero' : ''}${included ? ' is-included' : ''}${key === 'total' ? ' is-total' : ''}${key === 'unmetCashFlow' && row[key] > 0 ? ' is-shortfall' : ''}`}>
      <dt>{label}</dt><dd>{fmtMoneyFull(row[key] / factor)}</dd>
    </div>;
  })}</dl>{!showZeros && fields.every(([key]) => row[key] === undefined || row[key] === 0) && !fields.some(([key]) => key === 'total' || key === 'unmetCashFlow') && <p className="year-empty">No nonzero amounts this year.</p>}</>;
  const nestIncluded = fields => fields.filter(([key]) => !['seppIncome', 'seppBalance'].includes(key)).flatMap(field => {
    const includedKey = field[0] === 'fromIra' ? 'seppIncome' : field[0] === 'tradIra' ? 'seppBalance' : null;
    const included = fields.find(([key]) => key === includedKey);
    return included ? [field, included] : [field];
  });
  return <section className="year-inspector" aria-label="Selected year breakdown">
    <div className="year-inspector-heading"><div><h2>{row.year} in detail</h2><p>Age {row.age}{row.spouseAge != null ? ` · Spouse age ${row.spouseAge}` : ''} · {real ? "Today's dollars" : 'Future dollars'}</p></div>
      <div className="year-tools"><label className="year-zero-toggle"><input type="checkbox" checked={showZeros} onChange={event => setShowZeros(event.target.checked)} />Show zero values</label>
      <div className="year-picker"><button type="button" aria-label="Previous year" title="Previous year" disabled={index <= 0} onClick={() => onSelect(rows[index-1].year)}>‹</button>
        <label><span className="sr-only">Year</span><select value={row.year} onChange={event => onSelect(Number(event.target.value))}>{rows.map(item => <option key={item.year} value={item.year}>{item.year} · Age {item.age}</option>)}</select></label>
        <button type="button" aria-label="Next year" title="Next year" disabled={index < 0 || index === rows.length-1} onClick={() => onSelect(rows[index+1].year)}>›</button></div></div></div>
    {row.calculationNotice && <p role="status">{row.calculationNotice}</p>}
    <div className="year-summary" aria-label="Year summary"><dl>{summary.filter(([, value]) => value !== undefined).map(([label, value, tone]) =>
      <div key={label} className={tone || ''}><dt>{label}</dt><dd>{fmtMoneyFull(value / factor)}</dd></div>
    )}</dl><p>Account withdrawals exclude Roth conversions and do not count included amounts twice. Surplus savings and unfunded need are detailed below.</p></div>
    <div className="year-groups">{YEAR_GROUPS.map(([title, fields], groupIndex) => <section key={title} className={groupIndex === 3 ? 'year-portfolio-panel' : ''}><header><h3>{title}</h3><p>{descriptions[groupIndex]}</p></header>
      <div className="year-panel-body">
      {groupIndex === 0 ? <>
        <h4>Income</h4>{renderFields(fields.slice(0, 5))}
        <h4>Spending and taxes</h4>{renderFields(fields.slice(5, 8))}
        <h4>Shortfall</h4>{renderFields(fields.slice(8))}
      </> : renderFields(nestIncluded(fields))}
      </div>
    </section>)}</div>
    {children}
    <details className="raw-year"><summary>All calculated fields for this year</summary><p>Unadjusted engine output in future dollars; includes flags and per-owner detail.</p><pre>{JSON.stringify(row,null,2)}</pre></details>
    <p className="muted">Roth conversions transfer assets between accounts; they are not spending withdrawals. Employer Roth is included in the Roth total, and SEPP is included in the traditional IRA total. These breakdowns and tax components must not be added twice.</p>
  </section>;
}

export function CompactMetric({ label, value, detail, tone, basis }) {
  return <div className={`compact-metric ${tone || ''}`}><span>{label}</span><strong>{value}</strong>
    {basis && <small className="metric-basis">{basis}</small>}
    <details className="metric-detail"><summary>How to read this<span className="sr-only">: {label}</span></summary><p>{detail}</p></details></div>;
}
