import { useNavigate } from 'react-router-dom';
import { Card, PageHead, StatusChip } from '@/components/saas';
import { pipelineFeature, saasHorses, stateToTone } from '@/data/xbarSaasMock';

const STAGES = ['Packet prepared', 'Buyer invited', 'Deal room opened', 'Offer received', 'Release ready'];

function offerLabel(h: (typeof saasHorses)[number]) {
  return h.currentOffer ? `$${h.currentOffer.toLocaleString()}` : '—';
}

export default function SalesPipeline() {
  const navigate = useNavigate();

  return (
    <>
      <PageHead
        eyebrow="Transactions"
        title="Sales Pipeline"
        subtitle="Move horses from packet preparation to a buyer-ready release across every active deal."
        actions={
          <button type="button" className="xs-btn xs-btn--primary" onClick={() => navigate('/sale-packet-studio')}>
            New Deal
          </button>
        }
      />

      <Card title={pipelineFeature.name} subtitle="Featured deal" link="Open deal room" onLink={() => navigate('/buyer-deal-room')}>
        <div className="xs-stepbar">
          {pipelineFeature.steps.map((label, i) => (
            <div key={label} className="xs-step">
              <div className={`xs-step__bar${i < pipelineFeature.currentStep ? ' xs-step__bar--done' : i === pipelineFeature.currentStep ? ' xs-step__bar--current' : ''}`} />
              <div className={`xs-step__label${i === pipelineFeature.currentStep ? ' xs-step__label--current' : ''}`}>{label}</div>
            </div>
          ))}
        </div>
        <div className="xs-pipeline__stats">
          <div>
            <div className="xs-stat__value">${pipelineFeature.currentOffer.toLocaleString()}</div>
            <div className="xs-stat__label">Current offer</div>
          </div>
          <div>
            <div className="xs-stat__value">${pipelineFeature.targetPrice.toLocaleString()}</div>
            <div className="xs-stat__label">Target sale price</div>
          </div>
          <div>
            <div className="xs-stat__value">{pipelineFeature.daysActive}</div>
            <div className="xs-stat__label">Days active</div>
          </div>
          <div style={{ marginLeft: 'auto', alignSelf: 'center' }}>
            <button type="button" className="xs-btn xs-btn--primary xs-btn--sm" onClick={() => navigate('/buyer-deal-room')}>
              Update Deal
            </button>
          </div>
        </div>
      </Card>

      <Card title="All deals" subtitle="Every horse in an active or pending sale">
        <table className="xs-table">
          <thead>
            <tr>
              <th>Horse</th>
              <th>Discipline</th>
              <th>Stage</th>
              <th>Status</th>
              <th>Current offer</th>
              <th>Target</th>
              <th>Buyer views</th>
            </tr>
          </thead>
          <tbody>
            {saasHorses.map((h) => {
              const stage = h.saleStatus === 'Hold' ? 0 : h.packetShared ? (h.currentOffer ? 3 : 2) : 1;
              return (
                <tr key={h.id} onClick={() => navigate('/buyer-deal-room')}>
                  <td style={{ fontWeight: 600 }}>{h.name}</td>
                  <td className="xs-muted">{h.discipline}</td>
                  <td>{STAGES[stage]}</td>
                  <td>
                    <StatusChip tone={stateToTone[h.saleStatus]}>{h.saleStatus}</StatusChip>
                  </td>
                  <td>{offerLabel(h)}</td>
                  <td>${h.targetPrice.toLocaleString()}</td>
                  <td>{h.buyerViews}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}
