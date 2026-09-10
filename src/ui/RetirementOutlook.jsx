import { useId } from 'react';
import { Area, AreaChart, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtMoney, fmtMoneyFull } from '../finance/engine.js';
import { buildOutlook } from './outlookModel.js';
import './RetirementOutlook.css';

export function CompactOutlook({ rows, shortfall, summary, scenario, isCouple, onDashboard, onReview, simulationStatus }) {
  const outlook = buildOutlook(rows, shortfall, summary.calculationValid);
  return <div className="workspace-status print:hidden" aria-label="Active plan status">
    <span><strong>{scenario}</strong> · {outlook.label}{outlook.age != null ? ` · ${outlook.shortfallRow ? 'First shortfall' : 'Plan through'} ${isCouple ? 'primary ' : ''}age ${outlook.age}` : ''}</span>
    {simulationStatus && <span>{simulationStatus}</span>}
    <button onClick={onDashboard}>Full outlook</button>
    {summary.modelNotices?.length > 0 && <button onClick={onReview}>Review {summary.modelNotices.length} financial notes</button>}
  </div>;
}

export function RetirementOutlook({ rows, shortfall, summary, retirementAge, isCouple, real, onYears, onReview, children }) {
  const gradientId = useId().replaceAll(':', '');
  const outlook = buildOutlook(rows, shortfall, summary.calculationValid);
  const { first, last, shortfallRow, depleted, tone } = outlook;
  const notices = summary.modelNotices ?? [];
  if (!first || !last) return null;
  const retirement = rows.find(row => row.age === retirementAge);
  return <section className="retirement-outlook" aria-label="Retirement outlook summary">
    <div className="outlook-main">
      <div className="outlook-story">
        <p className={`outlook-status ${tone}`}><span aria-hidden="true" />{outlook.label}</p>
        <h3>{outlook.headline}{outlook.age != null && <> <span className={shortfallRow ? 'outlook-shortfall-age' : ''}>{outlook.age}</span></>}</h3>
        <p className="outlook-description">{outlook.detail}</p>
        {isCouple && <p className="outlook-basis">Ages shown are for the primary person.</p>}
        {summary.calculationValid === false && shortfallRow && <p className="outlook-basis">Provisional estimate. Review unresolved financial details.</p>}
        <div className="outlook-actions">
          <button className="outlook-detail-action" onClick={onYears}>Year-by-year detail <span aria-hidden="true">→</span></button>
          {notices.length > 0 && <button className="outlook-review-action" onClick={onReview}>Review {notices.length} {notices.length === 1 ? 'detail' : 'details'} <span aria-hidden="true">→</span></button>}
        </div>
      </div>
      <div className="outlook-chart-panel">
        <div className="outlook-chart-caption"><span>Portfolio balance</span><span>{real ? "Today's dollars" : 'Future dollars'}</span></div>
        <div className="outlook-chart" role="img" aria-label={`Projected portfolio from age ${first.age} to ${last.age}.${shortfallRow ? ` ${depleted ? 'Depletion' : 'First shortfall'} at age ${shortfallRow.age}.` : ''}`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 28, right: 20, bottom: 0, left: 4 }} accessibilityLayer>
              <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7560d5" stopOpacity={0.22} /><stop offset="100%" stopColor="#7560d5" stopOpacity={0.015} /></linearGradient></defs>
              <XAxis type="number" dataKey="age" domain={first.age === last.age ? [first.age - 1, last.age + 1] : [first.age, last.age]} ticks={outlook.ticks} interval={0} tickLine={false} axisLine={false}
                tick={({ x, y, payload }) => <text x={x} y={y + 12} textAnchor={payload.value === first.age ? 'start' : payload.value === last.age ? 'end' : 'middle'} fill="#64748b" fontSize={12}>Age {payload.value}</text>} />
              <YAxis hide domain={[0, 'auto']} />
              <Tooltip formatter={value => [fmtMoneyFull(value), 'Portfolio']} labelFormatter={age => `Age ${age}${isCouple ? ' (primary)' : ''}`} contentStyle={{ borderRadius: 8, borderColor: '#e2e0ed', fontSize: 12 }} />
              {shortfallRow && <ReferenceArea x1={shortfallRow.age} x2={last.age} fill="#be123c" fillOpacity={0.045} />}
              {retirement && retirement.age !== shortfallRow?.age && <ReferenceLine className="outlook-retirement-marker" x={retirement.age} stroke="#b4a7df" strokeDasharray="3 4" label={{ value: `Retirement · ${retirement.age}`, position: 'insideTopLeft', fill: '#71628f', fontSize: 12 }} />}
              <Area type="linear" dataKey="total" stroke="#7155ce" strokeWidth={2.5} fill={`url(#${gradientId})`} isAnimationActive={false} />
              {shortfallRow && <ReferenceLine x={shortfallRow.age} stroke="#be123c" strokeDasharray="4 4" label={{ value: `${depleted ? 'Depleted' : 'Shortfall'} · ${shortfallRow.age}`, position: shortfallRow.age > (first.age + last.age) / 2 ? 'insideTopRight' : 'insideTopLeft', fill: '#a51235', fontSize: 12 }} />}
              {shortfallRow && <ReferenceDot x={shortfallRow.age} y={shortfallRow.total} r={4} fill="#be123c" stroke="white" strokeWidth={2} />}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {retirement && <p className="outlook-milestone">Retirement begins at age {retirement.age}</p>}
        <p className="outlook-chart-footnote">End-of-year balances · Plan ends at age {last.age} · {fmtMoney(last.total)} remaining</p>
      </div>
    </div>
    <div className="outlook-metrics">{children}</div>
    {notices.length > 0 && <details className="outlook-notices"><summary>Financial notes behind this estimate ({notices.length})</summary><p>Estimates remain provisional. Sustainable spending is withheld while material inputs are unresolved.</p><ul>{notices.map(notice => <li key={notice}>{notice}</li>)}</ul></details>}
  </section>;
}
