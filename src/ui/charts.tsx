import { useLayoutEffect, useRef, useState } from 'react';
import { formatMoney } from '../core/money';
import { useApp } from '../app/context';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setW(Math.max(200, Math.floor(e[0].contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Paired bars (e.g. income vs expenses) with an optional net line. */
export function PairBars({ data, aLabel, bLabel, height = 220, showNet, aColor = 'var(--income)' }: { data: { label: string; a: number; b?: number }[]; aLabel: string; bLabel?: string; height?: number; showNet?: boolean; aColor?: string }) {
  const { fin } = useApp();
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 52, padB = 24, padT = 10;
  const max = niceMax(Math.max(1, ...data.flatMap((d) => [d.a, d.b ?? 0])));
  const minNet = showNet ? Math.min(0, ...data.map((d) => d.a - (d.b ?? 0))) : 0;
  const lo = minNet < 0 ? -niceMax(-minNet) : 0;
  const ih = height - padB - padT;
  const y = (v: number) => padT + ih - ((v - lo) / (max - lo)) * ih;
  const slot = (w - padL) / Math.max(1, data.length);
  const bw = Math.min(18, (slot - 8) / (bLabel ? 2 : 1));
  const ticks = [lo, lo + (max - lo) / 2, max];
  const f = (v: number) => formatMoney(v, fin.base, { compact: true });
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg className="chart" width={w} height={height} role="img" aria-label={`${aLabel}${bLabel ? ' and ' + bLabel : ''} by period`}>
        {ticks.map((t) => <g key={t}><line className="grid-line" x1={padL} x2={w} y1={y(t)} y2={y(t)} /><text x={padL - 6} y={y(t) + 4} textAnchor="end">{f(t)}</text></g>)}
        {data.map((d, i) => {
          const x = padL + i * slot + slot / 2;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(i)}>
              <rect x={padL + i * slot} y={padT} width={slot} height={ih} fill={hover === i ? 'var(--surface-2)' : 'transparent'} />
              <rect x={x - (bLabel ? bw + 1 : bw / 2)} y={y(d.a)} width={bw} height={Math.max(0, y(0) - y(d.a))} rx={3} fill={aColor} />
              {bLabel && <rect x={x + 1} y={y(d.b ?? 0)} width={bw} height={Math.max(0, y(0) - y(d.b ?? 0))} rx={3} fill="var(--spend)" opacity={0.85} />}
              {(data.length <= 8 || i % Math.ceil(data.length / 8) === 0) && <text x={x} y={height - 6} textAnchor="middle">{d.label}</text>}
            </g>
          );
        })}
        {showNet && <polyline fill="none" stroke="var(--azure)" strokeWidth={2} points={data.map((d, i) => `${padL + i * slot + slot / 2},${y(d.a - (d.b ?? 0))}`).join(' ')} />}
      </svg>
      <div className="row tiny muted" style={{ gap: 14, marginTop: 6 }}>
        <span className="row" style={{ gap: 5 }}><i style={{ width: 10, height: 10, background: aColor, borderRadius: 3 }} />{aLabel}</span>
        {bLabel && <span className="row" style={{ gap: 5 }}><i style={{ width: 10, height: 10, background: 'var(--spend)', borderRadius: 3 }} />{bLabel}</span>}
        {showNet && <span className="row" style={{ gap: 5 }}><i style={{ width: 12, height: 2, background: 'var(--azure)' }} />Net</span>}
        {hover != null && data[hover] && <span style={{ marginLeft: 'auto', color: 'var(--ink)' }}>{data[hover].label}: {f(data[hover].a)}{bLabel ? ` / ${f(data[hover].b ?? 0)}` : ''}</span>}
      </div>
    </div>
  );
}

export function LineChart({ data, height = 200, color = 'var(--azure)', label }: { data: { label: string; v: number }[]; height?: number; color?: string; label: string }) {
  const { fin } = useApp();
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 56, padB = 22, padT = 12;
  const vals = data.map((d) => d.v);
  let lo = Math.min(...vals, 0), hi = Math.max(...vals, 1);
  if (lo < 0) lo = -niceMax(-lo);
  hi = niceMax(hi);
  const ih = height - padB - padT;
  const x = (i: number) => padL + (data.length > 1 ? (i / (data.length - 1)) * (w - padL - 8) : (w - padL) / 2);
  const y = (v: number) => padT + ih - ((v - lo) / (hi - lo || 1)) * ih;
  const pts = data.map((d, i) => `${x(i)},${y(d.v)}`).join(' ');
  const f = (v: number) => formatMoney(v, fin.base, { compact: true });
  return (
    <div ref={ref}>
      <svg className="chart" width={w} height={height} role="img" aria-label={label}
        onMouseMove={(e) => { const r = (e.currentTarget as SVGElement).getBoundingClientRect(); const i = Math.round(((e.clientX - r.left - padL) / (w - padL - 8)) * (data.length - 1)); setHover(Math.max(0, Math.min(data.length - 1, i))); }}
        onMouseLeave={() => setHover(null)}>
        {[lo, (lo + hi) / 2, hi].map((t) => <g key={t}><line className="grid-line" x1={padL} x2={w} y1={y(t)} y2={y(t)} /><text x={padL - 6} y={y(t) + 4} textAnchor="end">{f(t)}</text></g>)}
        {lo < 0 && <line x1={padL} x2={w} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" />}
        <polygon points={`${x(0)},${y(Math.max(lo, 0))} ${pts} ${x(data.length - 1)},${y(Math.max(lo, 0))}`} fill={color} opacity={0.08} />
        <polyline points={pts} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" />
        {data.map((d, i) => (data.length <= 12 || i % 2 === 0) && <text key={i} x={x(i)} y={height - 5} textAnchor="middle">{d.label}</text>)}
        {hover != null && <g><line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + ih} stroke="var(--line-strong)" /><circle cx={x(hover)} cy={y(data[hover].v)} r={4} fill={color} /></g>}
      </svg>
      {hover != null && <div className="tiny" style={{ textAlign: 'right' }}>{data[hover].label}: <b className="num">{formatMoney(data[hover].v, fin.base)}</b></div>}
    </div>
  );
}

/** Ranked horizontal bars — clearer than a pie for "where did the money go". */
export function RankBars({ rows, total, onPick, max = 8, cur }: { rows: { name: string; amount: number; color?: string | null }[]; total?: number; onPick?: (name: string) => void; max?: number; cur?: string }) {
  const { fin } = useApp();
  const shown = rows.slice(0, max);
  const rest = rows.slice(max).reduce((s, r) => s + r.amount, 0);
  const top = Math.max(1, ...shown.map((r) => r.amount));
  const sum = total ?? rows.reduce((s, r) => s + r.amount, 0);
  const all = rest > 0 ? [...shown, { name: `${rows.length - max} more`, amount: rest, color: '#94a3b8' }] : shown;
  return (
    <div className="stack" style={{ gap: 10 }}>
      {all.map((r) => (
        <button key={r.name} type="button" onClick={() => onPick?.(r.name)} style={{ all: 'unset', cursor: onPick ? 'pointer' : 'default', display: 'block' }}>
          <div className="spread small"><span className="ellipsis">{r.name}</span><span className="num"><b>{formatMoney(r.amount, cur ?? fin.base)}</b> <span className="muted">{sum ? Math.round((r.amount / sum) * 100) : 0}%</span></span></div>
          <div style={{ height: 7, borderRadius: 99, background: 'var(--surface-2)', marginTop: 4 }}><div style={{ width: `${(r.amount / top) * 100}%`, height: '100%', borderRadius: 99, background: r.color ?? 'var(--azure)' }} /></div>
        </button>
      ))}
    </div>
  );
}

export function Spark({ values, color = 'var(--azure)', width = 120, height = 34 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values), hi = Math.max(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 3 - ((v - lo) / (hi - lo || 1)) * (height - 6)}`).join(' ');
  return <svg width={width} height={height} aria-hidden="true"><polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" /></svg>;
}

/** Remaining-balance curves for debt payoff methods. */
export function MultiLine({ series, height = 220 }: { series: { name: string; color: string; values: number[]; dashed?: boolean }[]; height?: number }) {
  const { fin } = useApp();
  const [ref, w] = useWidth<HTMLDivElement>();
  const padL = 56, padB = 22, padT = 10;
  const n = Math.max(...series.map((s) => s.values.length));
  const hi = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const ih = height - padB - padT;
  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * (w - padL - 8);
  const y = (v: number) => padT + ih - (v / hi) * ih;
  const years = Math.ceil((n - 1) / 12);
  return (
    <div ref={ref}>
      <svg className="chart" width={w} height={height} role="img" aria-label="Remaining debt over time by method">
        {[0, hi / 2, hi].map((t) => <g key={t}><line className="grid-line" x1={padL} x2={w} y1={y(t)} y2={y(t)} /><text x={padL - 6} y={y(t) + 4} textAnchor="end">{formatMoney(t, fin.base, { compact: true })}</text></g>)}
        {Array.from({ length: years + 1 }, (_, k) => k * 12).filter((m) => m < n).map((m) => <text key={m} x={x(m)} y={height - 5} textAnchor="middle">{m === 0 ? 'Now' : `${m / 12}y`}</text>)}
        {series.map((s) => <polyline key={s.name} points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={s.color} strokeWidth={2.2} strokeDasharray={s.dashed ? '7 5' : undefined} />)}
      </svg>
      <div className="row tiny muted wrap" style={{ gap: 14 }}>{series.map((s) => <span key={s.name} className="row" style={{ gap: 5 }}><i style={{ width: 12, height: 3, background: s.color }} />{s.name}</span>)}</div>
    </div>
  );
}
