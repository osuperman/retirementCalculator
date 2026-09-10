// Only numeric settings participate in the save reminder. Traverse both sides
// so removing a numeric history entry is still a change.
export function hasNumericChanges(current, baseline) {
  if (typeof current === 'number' || typeof baseline === 'number') {
    const numeric = value => typeof value === 'string' && value.trim() !== ''
      ? Number(value) : value;
    return !Object.is(numeric(current), numeric(baseline));
  }
  const left = current && typeof current === 'object' ? current : {};
  const right = baseline && typeof baseline === 'object' ? baseline : {};
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .some(key => hasNumericChanges(left[key], right[key]));
}
