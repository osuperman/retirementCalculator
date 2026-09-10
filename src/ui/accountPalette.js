// Account identities are categorical and shared by every account visualization.
export const ACCOUNT_SERIES = [
  { key: 'cash', label: 'Cash / HYSA', color: 'var(--account-cash)' },
  { key: 'taxable', label: 'Taxable', color: 'var(--account-taxable)' },
  { key: 'inherited', label: 'Inherited (BCO)', color: 'var(--account-inherited)' },
  { key: 'k401', label: '401k', color: 'var(--account-employer)' },
  { key: 'tradIra', label: 'Trad IRA', color: 'var(--account-ira)' },
  { key: 'roth', label: 'Roth', color: 'var(--account-roth)' },
  { key: 'hsa', label: 'HSA', color: 'var(--account-hsa)' },
];
export const accountColor = key => ACCOUNT_SERIES.find(account => account.key === key)?.color;
export const accountLabel = (key, couple = false) => key === 'k401' && couple
  ? 'Employer plans' : ACCOUNT_SERIES.find(account => account.key === key)?.label;
