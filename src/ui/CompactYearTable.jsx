import { fmtMoneyFull, materialYearUnmetThreshold } from '../finance/engine.js';

export function CompactYearTable({ rows, adjustRow, year1Spending, selectedYear, onSelect }) {
  const inspect = year => {
    onSelect(year);
    const inspector = document.querySelector('.year-inspector');
    inspector?.scrollIntoView({ block: 'start' });
    inspector?.querySelector('select')?.focus({ preventScroll: true });
  };
  return <div className="compact-year-view">
    <p>Select a year for its complete breakdown. Withdrawals exclude Roth conversions; income shows spendable pay, Social Security and pension.</p>
    <table className="compact-year-table">
      <thead><tr>{['Year / Age', 'Income', 'Withdrawals', 'Spending + tax', 'Ending balance'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{rows.filter(row => row.phase !== 'accumulation').map(raw => {
        const row = adjustRow(raw);
        const income = (row.wages || 0) + (row.partTime || 0) + (row.ss || 0) + (row.pension || 0);
        const withdrawals = ['fromCash', 'fromTaxable', 'from401k', 'fromIra', 'fromRoth', 'fromInherited', 'hsaWithdrawal'].reduce((sum, key) => sum + (row[key] || 0), 0);
        const shortfall = (raw.unmetCashFlow || 0) > materialYearUnmetThreshold(year1Spending) || raw.total <= 0;
        return <tr key={row.year} data-shortfall={shortfall} data-selected={selectedYear === row.year}>
          <th scope="row"><button aria-label={`Inspect year ${row.year}`} onClick={() => inspect(row.year)}>{row.year}<small>Age {Math.round(row.primaryAge ?? row.age)}{row.spouseAge != null ? ` / ${Math.round(row.spouseAge)}` : ''}</small></button>
            {shortfall && <span className="compact-year-warning">SHORTFALL</span>}</th>
          {[['Income', income], ['Withdrawals', withdrawals], ['Spending + tax', (row.spending || 0) + (row.tax || 0)], ['Ending balance', row.total]].map(([label, value]) => <td key={label} data-label={label}>{fmtMoneyFull(value)}</td>)}
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
