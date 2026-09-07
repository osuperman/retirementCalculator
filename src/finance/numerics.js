// Solve tax = liability(withdrawals(tax)). Evaluations must not mutate accounts.
// Bracketing handles very high marginal rates without silently truncating a
// fixed-point sequence. Discontinuous liabilities return an explicit failure.
export function solveTaxClosure(evaluate) {
  let lo = 0;
  let hi = Math.max(1, evaluate(0).tax);
  for (let i = 0; i < 60 && evaluate(hi).tax > hi; i++) hi *= 2;
  let result;
  for (let i = 0; i < 100; i++) {
    const tax = (lo + hi) / 2;
    result = evaluate(tax);
    const residual = result.tax - tax;
    if (Math.abs(residual) <= 0.00001) return { ...result, converged: true, residual };
    if (!Number.isFinite(residual)) break;
    if (residual > 0) lo = tax;
    else hi = tax;
  }
  const residual = result.tax - (lo + hi) / 2;
  return { ...result, converged: Math.abs(residual) < 0.01, residual };
}

export function provisionalRothLayers(layers, amount, year) {
  if (!layers) return null;
  const result={...layers,vintages:layers.vintages.map(v=>({...v}))};
  commitRothConversion(result,amount,year);
  return result;
}

export function commitRothConversion(layers,amount,year) {
  if (!layers || amount<=0) return;
  if (layers.firstYear==null && layers.knownEmpty) layers.firstYear=year;
  const vintage=layers.vintages.find(v=>v.year===year);
  if (vintage) {vintage.taxableAmount=(vintage.taxableAmount ?? vintage.amount)+amount;vintage.amount+=amount;}
  else layers.vintages.push({year,amount,taxableAmount:amount});
  layers.knownEmpty=false;
  layers.vintages.sort((a,b)=>a.year-b.year);
}
