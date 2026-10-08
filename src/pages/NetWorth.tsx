import { useApp } from '../app/context';
import { PageHead, Panel, Money, Stat, Chip, AltLine } from '../ui/components';
import { LineChart, PairBars } from '../ui/charts';
import { formatMoney } from '../core/money';
import type { Scope } from '../core/types';

export default function NetWorth() {
  const { fin, scope } = useApp();
  const nw = fin.netWorth(fin.ref, scope);
  const hist = fin.netWorthHistory(24, scope);
  const healthScope: Scope = scope === 'business' ? 'business' : scope === 'all' ? 'all' : 'personal';
  const h = fin.health(healthScope);
  const first = hist.find((x) => x.assets || x.liabilities);
  const yearAgo = hist[hist.length - 13];
  const fmt = (m: (typeof h.metrics)[number]) => m.value == null ? '—' : m.unit === 'money' ? formatMoney(m.value, fin.base, { sign: m.key === 'nw_growth' || m.key === 'cash_flow' }) : m.unit === 'months' ? `${m.value} months` : `${m.value}%`;
  const tone = (m: (typeof h.metrics)[number]) => m.value == null ? '' : m.good(m.value) ? 'ok' : m.warn(m.value) ? 'bad' : 'warn';
  const label = (m: (typeof h.metrics)[number]) => m.value == null ? 'Not enough data' : m.good(m.value) ? 'Healthy' : m.warn(m.value) ? 'Needs attention' : 'Okay';

  return (<>
    <PageHead title="Net worth & financial health" sub="Net worth = everything you own (including money owed to you) minus everything you owe." />
    <div className="grid g4">
      <Stat label="Net worth" v={nw.netWorth} tone="auto" />
      <Stat label="Assets" v={nw.totalAssets} />
      <Stat label="Liabilities" v={nw.totalLiabilities} />
      <Stat label="Change over 12 months" v={yearAgo ? nw.netWorth - yearAgo.netWorth : 0} tone="auto" sub={first ? `Tracking since ${first.label}` : undefined} />
    </div>
    <Panel title="Net worth by month" className="">
      <LineChart data={hist.map((x) => ({ label: x.label, v: x.netWorth }))} height={240} label="Net worth over 24 months" />
    </Panel>
    <div className="grid g2" style={{ marginTop: 16 }}>
      <Panel title="Assets" flush>
        <div className="list">{Object.entries(nw.assets).map(([k, v]) => <div key={k} className="item"><div className="grow title">{k}</div><div className="amt"><Money v={v} alt /></div></div>)}
          <div className="day-head"><b>Total assets</b><b className="num">{formatMoney(nw.totalAssets, fin.base)}</b></div></div>
      </Panel>
      <Panel title="Liabilities" flush>
        <div className="list">{Object.entries(nw.liabilities).map(([k, v]) => <div key={k} className="item"><div className="grow title">{k}</div><div className="amt"><Money v={v} alt /></div></div>)}
          <div className="day-head"><b>Total liabilities</b><b className="num">{formatMoney(nw.totalLiabilities, fin.base)}</b></div></div>
      </Panel>
    </div>
    <Panel title="Assets vs. liabilities" className="">
      <PairBars data={hist.slice(-12).map((x) => ({ label: x.label, a: x.assets, b: x.liabilities }))} aLabel="Assets" bLabel="Liabilities" />
    </Panel>

    <div className="page-head" style={{ marginTop: 28 }}><div><h1 style={{ fontSize: 22 }}>Financial health</h1><p>{healthScope === 'all' ? 'Personal + business' : healthScope === 'business' ? 'Business' : 'Personal'} · based on {h.period}. These are reference ranges, not advice.</p></div></div>
    <div className="grid g2">
      {h.metrics.map((m) => (
        <div key={m.key} className="panel">
          <div className="spread"><span className="muted small">{m.label}</span><Chip kind={tone(m)}>{label(m)}</Chip></div>
          <div className="fig" style={{ fontSize: 26, marginTop: 4 }}>{fmt(m)}</div>
          {m.unit === 'money' && m.value != null && <AltLine v={m.value} />}
          <p className="small muted" style={{ marginTop: 6 }}>{m.explain}</p>
        </div>
      ))}
    </div>
  </>);
}
