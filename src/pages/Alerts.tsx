import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../app/context';
import { PageHead, Panel, Empty, Chip } from '../ui/components';
import { Icon } from '../ui/icons';
import { today } from '../core/dates';

/** While the app is open, show system notifications for new alerts (if the user allowed them). */
export function useSystemNotifications() {
  const { fin, setting, updateSetting } = useApp();
  useEffect(() => {
    if (setting('system_notifications', '0') !== '1' || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const seen: Record<string, string> = JSON.parse(setting('notified_keys', '{}'));
    const fresh = fin.alerts().filter((a) => !seen[a.key]);
    if (!fresh.length) return;
    try {
      if (fresh.length <= 3) fresh.forEach((a) => new Notification(a.title, { body: a.detail, tag: a.key }));
      else new Notification(`${fresh.length} new finance alerts`, { body: fresh.slice(0, 3).map((a) => a.title).join('\n'), tag: 'summary' });
    } catch { /* some browsers only allow notifications from a service worker */ }
    const d = today();
    for (const a of fresh) seen[a.key] = d;
    // keep the list small
    const pruned = Object.fromEntries(Object.entries(seen).filter(([, v]) => v >= d.slice(0, 7)));
    updateSetting('notified_keys', JSON.stringify(pruned));
  }, [fin.ref]);
}

export default function Alerts() {
  const { fin, setting, updateSetting } = useApp();
  const alerts = fin.alerts();
  const dismiss = (key: string) => {
    const d: string[] = JSON.parse(setting('dismissed_alerts', '[]'));
    updateSetting('dismissed_alerts', JSON.stringify([...d, key].slice(-500)));
  };
  const groups = [...new Set(alerts.map((a) => a.type))];
  return (<>
    <PageHead title="Alerts" sub="Bills, overdue invoices, budgets, unusual expenses and more — choose which ones in Settings → Notifications.">
      <Link className="btn" to="/settings#notifications"><Icon name="gear" />Alert settings</Link>
    </PageHead>
    {alerts.length === 0 ? <Panel><Empty title="All clear">No alerts right now.</Empty></Panel> : groups.map((g) => (
      <Panel key={g} title={g} flush className="">
        <div className="list">{alerts.filter((a) => a.type === g).map((a) => (
          <div key={a.key} className="item">
            <Chip kind={a.severity === 'danger' ? 'bad' : a.severity === 'warn' ? 'warn' : ''}>{a.severity === 'danger' ? 'Urgent' : a.severity === 'warn' ? 'Heads up' : 'Info'}</Chip>
            <div className="grow"><Link to={a.to} className="title" style={{ color: 'var(--ink)' }}>{a.title}</Link><div className="meta">{a.detail}</div></div>
            <button className="btn ghost sm" onClick={() => dismiss(a.key)}>Dismiss</button>
          </div>))}</div>
      </Panel>
    ))}
  </>);
}
