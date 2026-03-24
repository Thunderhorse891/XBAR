import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { useXbarStore } from '@/store/useXbarStore';

export default function Weather() {
  const weather = useXbarStore((state) => state.weather);

  return (
    <>
      <PageHeader
        eyebrow="Weather"
        title="Weather operations"
        description="Weather is treated as a real operating input now: transport, turnout, breeding, and pasture impact all sit in the same product language as the rest of the ranch."
      />

      <div className="metric-grid">
        <MetricCard label="Current temp" value={`${weather.currentTempF}F`} detail={weather.condition} />
        <MetricCard label="Wind" value={`${weather.windMph} mph`} detail="Transport and turnout sensitivity" tone="amber" />
        <MetricCard label="Humidity" value={`${weather.humidity}%`} detail="Barn and pasture comfort picture" tone="slate" />
        <MetricCard label="Risk level" value={weather.riskLevel} detail={`${weather.alerts.length} current weather alerts`} tone={weather.riskLevel === 'Watch' ? 'amber' : 'emerald'} />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Operations brief" title="Pasture and transport impact">
          <div className="detail-block">
            <strong>Pasture:</strong> {weather.pastureImpact}
          </div>
          <div className="detail-block">
            <strong>Transport:</strong> {weather.transportImpact}
          </div>
          <div className="detail-block">
            <strong>Breeding:</strong> {weather.breedingNote}
          </div>
        </Panel>

        <Panel eyebrow="Alerts" title="Current weather watches">
          <div className="stack-list">
            {weather.alerts.map((alert) => (
              <div key={alert.id} className="stack-item">
                <div className="stack-item__top">
                  <div>
                    <div className="stack-item__title">{alert.title}</div>
                    <div className="stack-item__copy">{alert.detail}</div>
                  </div>
                  <Pill tone={alert.severity === 'medium' ? 'amber' : 'blue'}>{alert.impact}</Pill>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}
