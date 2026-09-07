import { DEFAULT_INPUTS, DEFAULT_COUPLE_INPUTS } from '../src/finance/engine.js';
export const zero = { ...DEFAULT_INPUTS, projectionStartYear: 2026, rothFirstContributionYear: 2000,
  currentAge:60, retirementAge:60, planThroughAge:60,
  balanceCash:0,balanceTaxable:0,balance401k:0,balanceTradIra:0,balanceRoth:0,
  balanceHsa:0,balanceInherited:0,preReturn:0,postReturn:0,cashReturn:0,inflation:0,
  contrib401k:0,contribMatch:0,contribHsa:0,baseExpenses:0,
  healthcarePre65:0,healthcarePost65:0,ssIncome:0,partTimeIncome:0,partTimeYears:0,
  salaryIncome:0,pensionIncome:0,pensionCola:0,taxableAnnualTaxDrag:0,rmdStartAge:75,
};
export function couple(primary={},spouse={},shared={}) {
  return {primary:{...zero,...primary},spouse:{...zero,...spouse},
    shared:{...DEFAULT_COUPLE_INPUTS.shared,...zero,householdSize:2,...shared}};
}
