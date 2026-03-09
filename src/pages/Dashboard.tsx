import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHorses } from '@/store/useHorses';

const tasks = [
  { id: 1, title: 'Finalize spring vaccination packets', status: 'In Progress', priority: 'High' },
  { id: 2, title: 'Approve mare transfer documents', status: 'In Review', priority: 'High' },
  { id: 3, title: 'Reconcile feed invoice variance', status: 'In Progress', priority: 'Medium' },
  { id: 4, title: 'Close monthly breeder compliance log', status: 'Complete', priority: 'Low' },
];

const alerts = [
  { title: 'Vet review due', desc: 'BONNY LIL MAN ROGERS requires follow-up mobility review within 24 hours.', urgent: true },
  { title: 'Transfer paperwork check', desc: 'Review non-registered horses and finalize transfer-paper statuses.', urgent: false },
  { title: 'Owner profile completion', desc: 'Some records are missing owner or location metadata.', urgent: false },
];

const activity = [
  { actor: 'Ops Desk', action: 'Updated transfer docs for', subject: 'WIGGY N RED', time: '12m ago' },
  { actor: 'Trainer', action: 'Logged conditioning session for', subject: 'HANCOCK SILVER POCO', time: '38m ago' },
  { actor: 'Finance', action: 'Posted vet expense for', subject: 'BONNY LIL MAN ROGERS', time: '1h ago' },
  { actor: 'Health', action: 'Flagged vaccination follow-up for', subject: 'RT BLUE DOLLY 1321', time: '3h ago' },
];

const financial = [
  { month: 'Oct', value: 118000 }, { month: 'Nov', value: 123000 },
  { month: 'Dec', value: 126500 }, { month: 'Jan', value: 129500 },
  { month: 'Feb', value: 132000 }, { month: 'Mar', value: 136500 },
];

const priorityConfig: Record<string, { color: string; bg: string; dot: string }> = {
  High:   { color: '#ff3b30', bg: 'rgba(255,59,48,0.08)', dot: '#ff3b30' },
  Medium: { color: '#ff9500', bg: 'rgba(255,149,0,0.08)', dot: '#ff9500' },
  Low:    { color: '#34c759', bg: 'rgba(52,199,89,0.08)', dot: '#34c759' },
};

function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let start = 0;
    const step = value / (600 / 16);
    const timer = setInterval(() => {
      start += step;
      if (start >= value) { setDisplay(value); clearInterval(timer); }
      else setDisplay(Math.floor(start));
    }, 16);
    return () => clearInterval(timer);
  }, [value]);
  return <>{display}</>;
}

function BarChart() {
  const [animate, setAnimate] = useState(false);
  const maxVal = Math.max(...financial.map(d => d.value));
  useEffect(() => { const t = setTimeout(() => setAnimate(true), 300); return () => clearTimeout(t); }, []);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 100 }}>
      {financial.map((d, i) => (
        <div key={d.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
          <div style={{ width: '100%', borderRadius: '5px 5px 0 0', background: 'linear-gradient(180deg, #0a84ff, #0060d0)', transition: `height 0.6s cubic-bezier(.34,1.56,.64,1) ${i * 0.08}s`, height: animate ? `${(d.value / maxVal) * 85}px` : '0px' }} />
          <div style={{ fontSize: 10, color: '#8e8e93', fontWeight: 500 }}>{d.month}</div>
          <div style={{ fontSize: 9, color: '#aeaeb2' }}>${(d.value / 1000).toFixed(0)}k</div>
        </div>
      ))}
    </div>
  );
}

const card = { background: '#fff', borderRadius: 14, padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.05)' };

export default function Dashboard() {
  const { horses } = useHorses();
  const navigate = useNavigate();

  const stats = [
    { label: 'Total Horses', value: horses.length, sub: '+2 this quarter', color: '#0a84ff' },
    { label: 'Registered', value: horses.filter(h => h.registered).length, sub: 'AQHA current', color: '#34c759' },
    { label: 'Transfer Backlog', value: horses.filter(h => !h.registered).length, sub: 'Needs attention', color: '#ff9500' },
    { label: 'Monthly Margin', value: 54400, sub: '↑ 3.4% vs last month', color: '#5856d6', prefix: '$' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, letterSpacing: -0.5 }}>Dashboard</h1>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
        {stats.map(s => (
          <div key={s.label} style={{ ...card, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${s.color}, ${s.color}44)`, borderRadius: '14px 14px 0 0' }} />
            <div style={{ fontSize: 11, color: '#8e8e93', fontWeight: 500, marginBottom: 8, marginTop: 4 }}>{s.label}</div>
            <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: -1, lineHeight: 1, color: '#1c1c1e' }}>
              {s.prefix}{s.prefix ? s.value.toLocaleString() : <AnimatedNumber value={s.value} />}
            </div>
            <div style={{ fontSize: 11, color: s.color, marginTop: 6, fontWeight: 500 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Middle row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 12 }}>
        {/* Tasks */}
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Operations Taskboard</span>
            <span style={{ fontSize: 11, color: '#8e8e93', background: '#f2f2f7', padding: '3px 10px', borderRadius: 20, fontWeight: 500 }}>
              {tasks.filter(t => t.status === 'Complete').length}/{tasks.length} complete
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tasks.map(task => {
              const pc = priorityConfig[task.priority];
              return (
                <div key={task.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderRadius: 10, background: '#f9f9fb', border: '1px solid rgba(0,0,0,0.04)', cursor: 'pointer', transition: 'background 0.15s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f2f2f7')}
                  onMouseLeave={e => (e.currentTarget.style.background = '#f9f9fb')}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: task.status === 'Complete' ? '#8e8e93' : '#1c1c1e', textDecoration: task.status === 'Complete' ? 'line-through' : 'none', marginBottom: 2 }}>{task.title}</div>
                    <div style={{ fontSize: 11, color: task.status === 'Complete' ? '#34c759' : '#8e8e93', fontWeight: 500 }}>{task.status}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: pc.dot }} />
                    <span style={{ background: pc.bg, color: pc.color, fontSize: 10, padding: '3px 10px', borderRadius: 20, fontWeight: 600 }}>{task.priority}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Alerts */}
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Critical Alerts</span>
            <span style={{ background: 'rgba(255,59,48,0.1)', color: '#ff3b30', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20 }}>{alerts.length} items</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {alerts.map((a, i) => (
              <div key={i} style={{ paddingBottom: i < alerts.length - 1 ? 12 : 0, borderBottom: i < alerts.length - 1 ? '1px solid #f2f2f7' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                  {a.urgent && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff3b30', flexShrink: 0 }} />}
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{a.title}</span>
                </div>
                <div style={{ fontSize: 11, color: '#6d6d72', lineHeight: 1.55, paddingLeft: a.urgent ? 13 : 0 }}>{a.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Activity */}
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Recent Activity</span>
            <span style={{ fontSize: 11, color: '#0a84ff', fontWeight: 500 }}>Live stream</span>
          </div>
          {activity.map((a, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '10px 0', borderBottom: i < activity.length - 1 ? '1px solid #f2f2f7' : 'none', gap: 12 }}>
              <div style={{ display: 'flex', gap: 10, flex: 1 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg, #e8f4ff, #bdd8ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#0a84ff', flexShrink: 0 }}>
                  {a.actor.split(' ').map(w => w[0]).join('').slice(0, 2)}
                </div>
                <div style={{ fontSize: 12, color: '#3a3a3c', lineHeight: 1.5 }}>
                  <strong style={{ color: '#1c1c1e' }}>{a.actor}</strong> {a.action} <strong style={{ color: '#0a84ff' }}>{a.subject}</strong>
                </div>
              </div>
              <span style={{ fontSize: 11, color: '#aeaeb2', whiteSpace: 'nowrap', fontWeight: 500, paddingTop: 1 }}>{a.time}</span>
            </div>
          ))}
        </div>

        {/* Chart */}
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Financial Trend</span>
            <span style={{ fontSize: 11, color: '#8e8e93', fontWeight: 500 }}>Last 6 months</span>
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5, marginBottom: 14 }}>
            $136,500 <span style={{ fontSize: 13, color: '#34c759', fontWeight: 600 }}>↑ 3.4%</span>
          </div>
          <BarChart />
        </div>
      </div>
    </div>
  );
}
