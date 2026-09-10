export function buildOutlook(rows, shortfall, calculationValid = true) {
  const first = rows[0];
  const last = rows.at(-1);
  const shortfallRow = shortfall.status === 'danger'
    ? rows.find(row => row.year === shortfall.firstShortfallYear) : null;
  const depleted = shortfallRow?.total <= 0;
  const provisional = calculationValid === false;
  const tone = provisional ? 'caution' : shortfallRow ? 'danger' : shortfall.status === 'warning' ? 'caution' : 'funded';
  return {
    first, last, shortfallRow, depleted, tone,
    label: provisional ? 'Estimate needs review' : shortfallRow ? 'Projected shortfall' : shortfall.status === 'warning' ? 'Thin margin' : 'On track',
    headline: shortfallRow
      ? depleted ? 'Projected to last until age' : 'Projected shortfall at age'
      : provisional ? 'Calculation needs review' : 'Plan funded through age',
    age: shortfallRow?.age ?? (provisional ? null : last?.age),
    detail: shortfallRow
      ? `${Math.max(0, last.age - shortfallRow.age)} years short of your age ${last.age} target.${depleted ? '' : ' Some assets remain, but projected cash flow does not cover all needs.'}`
      : provisional ? 'Review the financial details before relying on this estimate.'
        : shortfall.status === 'warning' ? 'Projected needs are covered, with limited room for changes.' : 'Projected needs are covered through the end of your plan.',
    ticks: first && last ? [...new Set([first.age, ...(last.age - first.age > 15 ? [Math.round((first.age + last.age) / 2)] : []), last.age])] : [],
  };
}
