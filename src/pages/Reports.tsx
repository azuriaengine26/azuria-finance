import { useMemo, useState } from 'react';
import { useApp } from '../app/context';
import { PageHead, Panel, Select, DateInput, Segmented } from '../ui/components';
import { PairBars, LineChart } from '../ui/charts';
import { buildReport, REPORTS, type Cell } from '../core/reports';
import { presetRange, RANGE_LABELS, type RangePreset } from '../core/dates';
import { formatMoney } from '../core/money';
import { reportCSV, reportXLSX, reportPDF } from '../ui/exporters';
import type { Scope } from '../core/types';
import { Icon } from '../ui/icons';

function CellView({ c }: { c: Cell }) {
  if (c == null) return <span className="muted">—</span>;
  if (typeof c === 'object' && 'm' in c) return <span className={c.m < 0 ? 'neg' : ''}>{formatMoney(c.m, c.c)}</span>;
  if (typeof c === 'object' && 'p' in c) return <>{c.p == null ? '—' : `${c.p}%`}</>;
  return <>{c}</>;
}

export default function Reports() {
  const { fin, scope: globalScope, act } = useApp();
  const [id, setId] = useState('income_statement');
  const [preset, setPreset] = useState<RangePreset>('this_year');
  const [from, setFrom] = useState(fin.ref.slice(0, 4) + '-01-01');
  const [to, setTo] = useState(fin.ref);
  const [scope, setScope] = useState<Scope>(globalScope);
  const [busy, setBusy] = useState(false);
  const meta = REPORTS.find((r) => r.id === id)!;
  const range = preset === 'custom' ? { from, to } : presetRange(preset, fin.ref);
  const report = useMemo(() => act(() => buildReport(fin, id, range, scope)), [fin, id, range.from, range.to, scope]);
  const run = async (f: () => Promise<void> | void) => { setBusy(true); try { await f(); } catch (e: any) { act(() => { throw e; }); } finally { setBusy(false); } };

  return (<>
    <PageHead title="Reports" sub="Choose a report and period, then export it as CSV, Excel or PDF.">
      <button className="btn" disabled={!report || busy} onClick={() => run(() => reportCSV(report!))}><Icon name="download" />CSV</button>
      <button className="btn" disabled={!report || busy} onClick={() => run(() => reportXLSX(report!))}><Icon name="download" />Excel</button>
      <button className="btn primary" disabled={!report || busy} onClick={() => run(() => reportPDF(report!))}><Icon name="download" />PDF</button>
    </PageHead>
    <Panel>
      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
        <label className="field"><span>Report</span><Select value={id} onChange={(v) => setId(v ?? 'income_statement')} options={REPORTS.map((r) => ({ value: r.id, label: r.title }))} /></label>
        <label className="field"><span>Period</span><Select value={preset} onChange={(v) => setPreset((v ?? 'this_year') as RangePreset)} options={(Object.keys(RANGE_LABELS) as RangePreset[]).map((k) => ({ value: k, label: RANGE_LABELS[k] }))} /></label>
        {preset === 'custom' && <><label className="field"><span>From</span><DateInput value={from} onChange={setFrom} /></label><label className="field"><span>To</span><DateInput value={to} onChange={setTo} /></label></>}
        {meta.scoped && <div className="field"><span>Include</span><Segmented label="Scope" value={scope} onChange={setScope} options={[{ value: 'all' as Scope, label: 'All' }, { value: 'personal' as Scope, label: 'Personal' }, { value: 'business' as Scope, label: 'Business' }]} /></div>}
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>{meta.description}</p>
    </Panel>
    {report && (
      <Panel className="" title={<>{report.title}<div className="small muted" style={{ fontWeight: 400 }}>{report.subtitle}</div></>}>
        {report.chart && report.chart.values.length > 1 && (
          <div style={{ marginBottom: 18 }}>
            {report.chart.bLabel ? <PairBars data={report.chart.values} aLabel={report.chart.aLabel} bLabel={report.chart.bLabel} showNet={report.id !== 'net_worth'} />
              : <LineChart data={report.chart.values.map((v) => ({ label: v.label, v: v.a }))} label={report.chart.label} />}
          </div>
        )}
        <div className="stack" style={{ gap: 22 }}>
          {report.sections.map((s, i) => (
            <div key={i}>
              {s.title && <h3 style={{ marginBottom: 8 }}>{s.title}</h3>}
              {s.rows.length === 0 && !s.totals ? <p className="muted small">Nothing in this period.</p> : (
                <div className="tbl-wrap"><table className="tbl">
                  <thead><tr>{s.columns.map((c, k) => <th key={k} className={k > 0 && s.rows.some((r) => r[k] && typeof r[k] === 'object') ? 'r' : ''}>{c}</th>)}</tr></thead>
                  <tbody>{s.rows.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} className={c && typeof c === 'object' ? 'r' : ''}><CellView c={c} /></td>)}</tr>)}</tbody>
                  {s.totals && <tfoot><tr>{s.totals.map((c, j) => <td key={j} className={c && typeof c === 'object' ? 'r' : ''}><CellView c={c} /></td>)}</tr></tfoot>}
                </table></div>
              )}
            </div>
          ))}
        </div>
        {report.notes.length > 0 && <div className="stack small muted" style={{ marginTop: 18, gap: 6 }}>{report.notes.map((n, i) => <p key={i}>{n}</p>)}</div>}
      </Panel>
    )}
  </>);
}
