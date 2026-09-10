import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './YearComposition.css';
import { ACCOUNT_SERIES, accountLabel } from './accountPalette.js';

const accounts = ACCOUNT_SERIES.map(({key, label, color}) => [key, label, color]);
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const labelFor = (key, label, couple) => accountLabel(key, couple) || label;

export function CompositionLegend({ rows, couple }) {
  return <div className="composition-legend"><strong>Composition</strong>{accounts.filter(([key]) => rows.some(row => row[key] > 0)).map(([key, label, color]) => <span key={key}><i style={{ background: color }} />{labelFor(key, label, couple)}</span>)}</div>;
}

export function YearComposition({ row, maximum, real, couple }) {
  const [position, setPosition] = useState(null);
  const trigger = useRef(null);
  const tooltip = useRef(null);
  const id = useId();
  const segments = accounts.filter(([key]) => row[key] > 0);
  const open = () => {
    const rect = trigger.current.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    setPosition({ left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)), top: rect.top, width });
  };
  useEffect(() => {
    if (!position) return;
    const dismiss = () => setPosition(null);
    const escape = event => { if (event.key === 'Escape') dismiss(); };
    const outside = event => { if (!trigger.current?.contains(event.target) && !tooltip.current?.contains(event.target)) dismiss(); };
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    document.addEventListener('keydown', escape);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
      document.removeEventListener('keydown', escape);
      document.removeEventListener('pointerdown', outside);
    };
  }, [position]);
  return <>
    <button ref={trigger} type="button" className="year-composition" aria-label={`End-of-year account composition for ${row.year}, ${money.format(row.total || 0)}`} aria-describedby={position ? id : undefined}
      onMouseEnter={open} onMouseLeave={event => { if (!(event.relatedTarget instanceof Node) || !tooltip.current?.contains(event.relatedTarget)) setPosition(null); }} onFocus={open} onBlur={() => setPosition(null)} onClick={open}>
      <span className="year-composition-track">{segments.map(([key, , color]) => <span key={key} style={{ width: `${Math.min(100, row[key] / Math.max(maximum, row.total, 1) * 100)}%`, background: color }} />)}</span>
    </button>
    {position && createPortal(<div ref={tooltip} id={id} role="tooltip" className="composition-tooltip" style={{ left: position.left, width: position.width, ...(position.top > 360 ? { bottom: window.innerHeight - position.top } : { top: position.top + 32 }) }} onMouseLeave={() => setPosition(null)}>
      <div className="composition-tooltip-heading"><strong>{row.year} · {couple ? `Ages ${Math.round(row.primaryAge ?? row.age)} / ${Math.round(row.spouseAge)}` : `Age ${row.age}`}</strong><span>{real ? "Today's dollars" : 'Future dollars'}</span></div>
      <p>End-of-year balances</p>
      {segments.length ? segments.map(([key, label, color]) => <div className="composition-tooltip-account" key={key}><span><i style={{ background: color }} />{labelFor(key, label, couple)}</span><strong>{money.format(row[key])}</strong><small>{(row[key] / row.total * 100).toFixed(1)}%</small></div>) : <p>No remaining account balances.</p>}
      <div className="composition-tooltip-total"><span>Total portfolio</span><strong>{money.format(row.total || 0)}</strong></div>
    </div>, document.body)}
  </>;
}
