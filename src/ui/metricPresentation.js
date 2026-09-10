import { fmtMoney } from '../finance/engine.js';

export function moneyMetric(value, { depleted = false, none = false } = {}) {
  if (!Number.isFinite(value)) return 'Unavailable';
  if (value === 0 && depleted) return 'Depleted';
  if (value === 0 && none) return 'None';
  if (value > 0 && value < 1) return '<$1';
  return fmtMoney(value);
}
