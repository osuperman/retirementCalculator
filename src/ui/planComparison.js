import { getDisplayInputs, computeShortfallInfo } from '../finance/engine.js';
import { baselineChanges } from './baselineChanges.js';

// A working comparison is independent of the saved scenario store.
export function captureBaseline(inputs) {
  return structuredClone(inputs);
}

export function baselineSeries(baseline, currentRows, real = false) {
  if (!baseline) return currentRows.map(() => null);
  const settings = getDisplayInputs(baseline.inputs);
  const firstYear = baseline.results.yearlyData[0]?.year;
  const byYear = new Map(baseline.results.yearlyData.map(row => [row.year, row]));
  return currentRows.map(row => {
    const original = byYear.get(row.year);
    if (!original) return null;
    return original.total / (real ? Math.pow(1 + settings.inflation, row.year - firstYear) : 1);
  });
}

export function compareBaseline(baseline, inputs, results) {
  if (!baseline) return null;
  const original = getDisplayInputs(baseline.inputs);
  const current = getDisplayInputs(inputs);
  const before = computeShortfallInfo(baseline.results);
  const after = computeShortfallInfo(results);
  const beforeHorizon = baseline.results.yearlyData.at(-1)?.year ?? null;
  const afterHorizon = results.yearlyData.at(-1)?.year ?? null;
  const sameHorizon = beforeHorizon !== null && beforeHorizon === afterHorizon;
  return {
    changed: JSON.stringify(baseline.inputs) !== JSON.stringify(inputs),
    changes: baselineChanges(baseline.inputs, inputs),
    beforeHorizon,
    afterHorizon,
    beforeEnding: sameHorizon && Number.isFinite(baseline.results.summary.portfolioAtEnd) ? baseline.results.summary.portfolioAtEnd : null,
    afterEnding: sameHorizon && Number.isFinite(results.summary.portfolioAtEnd) ? results.summary.portfolioAtEnd : null,
    provisional: baseline.results.summary.calculationValid === false || results.summary.calculationValid === false,
    spending: current.baseExpenses - original.baseExpenses,
    ending: sameHorizon ? results.summary.portfolioAtEnd - baseline.results.summary.portfolioAtEnd : null,
    beforeYear: before.firstShortfallYear,
    afterYear: after.firstShortfallYear,
    // Calendar-year comparison remains meaningful if current ages change.
    beforeShortfall: baseline.results.yearlyData.find(row => row.age === before.firstShortfallAge)?.year ?? null,
    afterShortfall: results.yearlyData.find(row => row.age === after.firstShortfallAge)?.year ?? null,
  };
}
