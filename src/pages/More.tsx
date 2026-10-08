import { Link } from 'react-router-dom';
import { useApp } from '../app/context';
import { NAV } from '../App';
import { Icon } from '../ui/icons';

export default function More() {
  const { lock } = useApp();
  return (<>
    <h1 style={{ marginBottom: 16 }}>More</h1>
    <section className="panel flush"><div className="list">
      {NAV.filter((n) => !['/', '/transactions', '/accounts'].includes(n.to)).map((n) => <Link key={n.to} to={n.to} className="item"><span className="dot" style={{ background: 'var(--surface-2)', color: 'var(--ink)' }}><Icon name={n.icon} size={18} /></span><span className="title grow">{n.label}</span></Link>)}
      <Link to="/alerts" className="item"><span className="dot" style={{ background: 'var(--surface-2)', color: 'var(--ink)' }}><Icon name="bell" size={18} /></span><span className="title grow">Alerts</span></Link>
      <button className="item" onClick={() => lock()}><span className="dot" style={{ background: 'var(--surface-2)', color: 'var(--ink)' }}><Icon name="lock" size={18} /></span><span className="title grow">Lock now</span></button>
    </div></section>
  </>);
}
