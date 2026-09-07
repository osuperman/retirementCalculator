import { NumericField } from './ui/PlannerWorkspace.jsx';
const inputClass='mt-1 block w-full rounded border border-slate-300 bg-white p-2 text-sm text-slate-900';

export default function FinancialDetails({values,onChange,household=false,personOnly=false,scope=''}) {
  const startYear=values.projectionStartYear ?? new Date().getFullYear();
  const number=(key,label,nullable=false)=> <label className="block text-xs text-slate-700" key={key}>{label}<NumericField className={inputClass} min="0" step="any" nullable={nullable} data-unconfirmed={nullable && values[key] == null} placeholder={nullable ? 'Unconfirmed' : undefined} value={values[key]} onValue={onChange(key)}/></label>;
  const select=(key,label,options)=><label className="block text-xs text-slate-700" key={key}>{label}<select className={inputClass} data-unconfirmed={(values[key] ?? options[0][0]) === "unknown"} value={values[key] ?? options[0][0]} onChange={e=>onChange(key)(e.target.value)}>{options.map(([value,text])=><option key={value} value={value}>{text}</option>)}</select></label>;
  const check=(key,label)=><label className="flex gap-2 text-xs text-slate-700" key={key}><input type="checkbox" checked={values[key]===true} onChange={e=>onChange(key)(e.target.checked)}/>{label}</label>;
  const date=(key,label)=><label className="block text-xs text-slate-700" key={key}>{label}<input className={inputClass} type="date" value={values[key] || ''} onChange={e=>onChange(key)(e.target.value)}/></label>;
  const history=(key,label,years)=><fieldset className="space-y-2"><legend className="font-medium text-sm">{label}</legend>{years.map(year=><label className="block text-xs" key={year}>{year}<input className={inputClass} type="number" min="0" placeholder="Unknown" value={values[key]?.[year] ?? ''} onChange={e=>onChange(key)({...values[key],[year]:e.target.value===''?null:Number(e.target.value)})}/></label>)}</fieldset>;
  const title = `${scope || (household ? 'Household' : personOnly ? values.name || 'Owner' : '')}${scope || household || personOnly ? ': ' : ''}Tax eligibility and account history`;
  return <details data-settings-title={title} className="financial-details my-4 rounded border border-slate-200 bg-slate-50 p-3">
    <summary className="cursor-pointer text-sm font-semibold">{title}</summary>
    <p className="my-3 text-xs text-slate-600">Amounts are annual, in today’s dollars unless a historical tax year is shown. Blank eligibility facts remain unconfirmed. Healthcare classifications are portions of your existing healthcare budget.</p>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {!household && <>
        <fieldset className="financial-group"><legend>Roth and employer accounts</legend>
        {number('rothFirstContributionYear','First Roth IRA contribution tax year',true)}
        {number('balanceRoth401k','Employer Roth balance ($)')}
        {number('roth401kBasis','Employer Roth after-tax basis ($)')}
        {number('roth401kFirstYear','Employer Roth first contribution year',true)}
        {number('priorEmployerWages','Prior-year wages from this employer ($)',true)}
        {check('rothCatchupAvailable','Employer plan accepts Roth catch-ups')}
        {check('currentEmployerPlan','Traditional employer balance is in the current employer’s plan')}
        {check('fivePercentOwner','Owner is subject to the 5% owner exception to the still-working RMD exemption')}
        </fieldset><fieldset className="financial-group"><legend>HSA and healthcare qualification</legend>
        {select('hsaCoverage','HSA contribution coverage',[['unknown','Unknown'],['none','Not eligible'],['self','Self-only HDHP'],['family','Family HDHP']])}
        {number('hsaEligibleMonths','HSA eligible months per year (0–12)')}
        {number('medicareStartYear','Medicare enrollment year',true)}
        {number('medicareStartMonth','Medicare enrollment month (1–12)')}
        {check('hsaPayroll','HSA contributions are through a Section 125 payroll plan')}
        {number('hsaQualifiedExpenses','Qualified medical expenses excluding premiums ($)')}
        {number('hsaQualifiedPremiums','Qualified premium portion ($)')}
        {select('hsaPremiumType','Premium qualification',[['none','Ordinary insurance / Medigap (not eligible)'],['cobra','COBRA continuation'],['unemployment','Coverage while receiving unemployment'],['medicare','Medicare (HSA owner 65+)']])}
        </fieldset><fieldset className="financial-group"><legend>Social Security and survivor benefits</legend>
        {number('ssBirthMonth','Birth month for Social Security (1–12)')}
        {number('ssClaimMonth','First Social Security benefit month (1–12)')}
        {number('ssPriorWithheldMonths','Pre-projection benefit months withheld for earnings',true)}
        <details className="sm:col-span-2"><summary className="text-sm cursor-pointer">Monthly W-2 earnings for the Social Security test</summary>
          <p className="my-2 text-xs">Enter a calendar year to override equal monthly wages. A complete twelve-month entry is required, including zero for months without wages.</p>
          {Object.keys(values.ssMonthlyEarnings || {}).map(year=><fieldset key={year} className="my-2 grid grid-cols-3 gap-2"><legend className="text-sm">{year} covered wages</legend>{Array.from({length:12},(_,i)=><label key={i} className="text-xs">Month {i+1}<input className={inputClass} type="number" min="0" value={values.ssMonthlyEarnings[year][i] ?? 0} onChange={e=>onChange('ssMonthlyEarnings')({...values.ssMonthlyEarnings,[year]:Array.from({length:12},(_,j)=>i===j?Number(e.target.value):values.ssMonthlyEarnings[year][j] || 0)})}/></label>)}</fieldset>)}
          <label className="text-xs">Add calendar year<input className={inputClass} type="number" placeholder="2026" onBlur={e=>{const year=Number(e.target.value);if(year>=2026 && year<=2150 && !values.ssMonthlyEarnings?.[year])onChange('ssMonthlyEarnings')({...values.ssMonthlyEarnings,[year]:Array(12).fill(0)});}}/></label>
        </details>
        {number('survivorSsAnnual','SSA estimate of survivor annual benefit ($)',true)}
        {personOnly && number('deathYear','Optional death scenario year',true)}
        {values.deathYear != null && <>
          {number('deathMonth','Death month (1–12)')}
          {select('spouseInheritance','Spousal retirement-account election',[['unknown','Unconfirmed'],['own','Treat as spouse’s own accounts']])}
          {number('pensionSurvivorFraction','Pension continuation fraction (0–1)',true)}
        </>}
        </fieldset><fieldset className="financial-group"><legend>Early access and SEPP</legend>
        {check('useSepp','Model an isolated fixed-amortization SEPP account')}
        {values.useSepp && <>
          {date('birthDate','Date of birth for SEPP')}{date('seppStartDate','First SEPP payment date')}
          {number('seppAccountAmount','Amount allocated from IRA / separated employer plan ($)')}
          {number('seppAnnualPayment','Established payment for an existing SEPP ($)',true)}
          {check('seppFirstYearProrate','Prorate the first SEPP calendar year by month')}
          {number('seppModificationYear','Optional SEPP modification year',true)}
          {number('seppRecaptureTax','Calculated historical recapture tax ($)',true)}
          {number('seppRecaptureInterest','Calculated recapture interest ($)',true)}
        </>}
        </fieldset><fieldset className="space-y-2 sm:col-span-2"><legend className="text-sm font-medium">Existing Roth IRA conversions</legend>
          {(values.rothConversions || []).map((v,index)=><div key={index} className="grid grid-cols-3 gap-2">
            {['year','amount','taxableAmount'].map((field)=><label className="text-xs" key={field}>{field==='year'?'Tax year':field==='amount'?'Remaining principal ($)':'Remaining taxable conversion principal ($)'}<input className={inputClass} type="number" min="0" value={v[field] ?? 0} onChange={e=>onChange('rothConversions')((values.rothConversions || []).map((item,i)=>i===index?{...item,[field]:Number(e.target.value)}:item))}/></label>)}
            <button type="button" className="text-left text-xs text-red-700" onClick={()=>onChange('rothConversions')(values.rothConversions.filter((_,i)=>i!==index))}>Remove conversion</button>
          </div>)}
          <button type="button" className="text-xs font-medium text-blue-700" onClick={()=>onChange('rothConversions')([...(values.rothConversions || []),{year:2025,amount:0,taxableAmount:0}])}>Add conversion history</button>
        </fieldset>
      </>}
      {!personOnly && <>
      <fieldset className="financial-group"><legend>Calendar and marketplace coverage</legend>
      {number('projectionStartYear','Projection starting calendar year',true)}
      {check('acaEligible','Marketplace members are eligible for a premium credit (no disqualifying coverage)')}
      {number('acaAnnualPremium','Actual annual marketplace premium ($)')}
      {number('acaBenchmarkPremium','Applicable annual benchmark premium ($)')}
      {number('acaCoverageMonths','Marketplace coverage months (0–12)')}
      </fieldset><fieldset className="financial-group"><legend>Investment income and Medicare tax history</legend>
      {number('taxableOrdinaryYield','Brokerage ordinary dividend/interest yield (fraction, e.g. 0.02)')}
      {history('historicalMagi','Actual IRMAA lookback MAGI',[startYear-2,startYear-1])}
      {history('irmaaApprovedMagi','Approved IRMAA adjustment MAGI',[startYear,startYear+1])}
      </fieldset><fieldset className="financial-group"><legend>Survivor household</legend>
      {number('survivorBaseExpenses','Survivor lifestyle spending ($)',true)}
      {check('qualifyingSurvivingSpouse','Dependent and household requirements for qualifying surviving spouse status are met')}
      </fieldset></>}
      {!household && check('inheritedNyEligible','Inherited income is from a qualifying employment retirement arrangement for NY exclusion')}
    </div>
  </details>;
}
