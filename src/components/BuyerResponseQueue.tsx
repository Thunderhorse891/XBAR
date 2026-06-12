import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Panel, Pill } from '@/components/app-ui';
import { formatCompactCurrency, formatDateLabel } from '@/lib/format';
import { loadPublicBuyerRoomEventsFromCloud, recordBuyerRoomSellerResponseInCloud } from '@/lib/cloudWorkspace';
import { hasSellerResponse, openBuyerRequests, sortBuyerRoomEvents } from '@/lib/buyerDealRoom';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
import type { BuyerRoomEvent } from '@/types/xbar';

function eventLabel(kind: BuyerRoomEvent['kind']) {
  const labels: Record<BuyerRoomEvent['kind'], string> = {
    'packet-shared': 'Packet shared',
    'packet-viewed': 'Packet viewed',
    'packet-downloaded': 'Packet downloaded',
    question: 'Buyer question',
    'call-requested': 'Call requested',
    'proof-requested': 'Proof requested',
    offer: 'Buyer offer',
    'seller-response': 'Seller response',
    'deal-status': 'Deal status',
  };
  return labels[kind];
}

function eventTone(kind: BuyerRoomEvent['kind']) {
  if (kind === 'offer') return 'blue';
  if (kind === 'packet-downloaded') return 'blue';
  if (kind === 'question' || kind === 'call-requested' || kind === 'proof-requested') return 'amber';
  if (kind === 'seller-response') return 'emerald';
  return 'slate';
}

export function BuyerResponseQueue() {
  const events = useXbarStore((state) => state.buyerRoomEvents);
  const horses = useXbarStore((state) => state.horses);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const currentRole = useXbarStore((state) => state.currentRole);
  const logBuyerRoomEvent = useXbarStore((state) => state.logBuyerRoomEvent);
  const mergeBuyerRoomEvents = useXbarStore((state) => state.mergeBuyerRoomEvents);
  const captureBuyerRoomOffer = useXbarStore((state) => state.captureBuyerRoomOffer);
  const captureBuyerRoomFollowUp = useXbarStore((state) => state.captureBuyerRoomFollowUp);
  const canManageSales = useCurrentRoleCapability('manageSales');
  const [syncing, setSyncing] = useState(false);
  const [respondingEventId, setRespondingEventId] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const openRequests = openBuyerRequests(events);
  const activity = sortBuyerRoomEvents(events).slice(0, 30);

  const refresh = useCallback(async (showFailure = true) => {
    setSyncing(true);
    const result = await loadPublicBuyerRoomEventsFromCloud();
    setSyncing(false);
    if (result.ok) {
      setSyncMessage(mergeBuyerRoomEvents(result.events).message);
    } else if (showFailure) {
      setSyncMessage(result.message);
    }
  }, [mergeBuyerRoomEvents]);

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  const renderEvents = (visibleEvents: BuyerRoomEvent[], emptyTitle: string, emptyDescription: string) => (
    visibleEvents.length ? (
      <div className="stack-list">
        {visibleEvents.map((event) => {
          const horse = horses.find((item) => item.id === event.horseId);
          const needsResponse =
            (event.kind === 'question' || event.kind === 'call-requested' || event.kind === 'proof-requested') &&
            !hasSellerResponse(events, event);
          const offerCaptured =
            event.kind === 'offer' &&
            salesLeads.some(
              (lead) =>
                lead.horseId === event.horseId &&
                lead.name.trim().toLowerCase() === event.actor.trim().toLowerCase() &&
                lead.stage === 'Offer' &&
                lead.offerAmount === event.amount,
            );
          const packetDownloadLead =
            event.kind === 'packet-downloaded'
              ? salesLeads.find(
                  (lead) =>
                    lead.stage !== 'Closed' &&
                    lead.horseId === event.horseId &&
                    lead.name.trim().toLowerCase() === event.actor.trim().toLowerCase(),
                )
              : undefined;
          return (
            <div className="stack-item" key={event.id}>
              <div className="stack-item__top">
                <div>
                  <div className="stack-item__title">{eventLabel(event.kind)} · {horse?.name ?? 'Horse record'}</div>
                  <div className="stack-item__copy">{event.actor} · {formatDateLabel(event.at)}</div>
                </div>
                <Pill tone={eventTone(event.kind)}>{eventLabel(event.kind)}</Pill>
              </div>
              <div className="stack-item__copy" style={{ marginTop: 8 }}>
                {event.note || (event.kind === 'offer' && event.amount ? `Offer submitted for ${formatCompactCurrency(event.amount)}.` : 'Buyer activity recorded.')}
              </div>
              <div className="inline-actions" style={{ marginTop: 10 }}>
                {event.amount ? <Pill tone="blue">{formatCompactCurrency(event.amount)}</Pill> : null}
                {event.kind === 'offer' && offerCaptured ? <Pill tone="emerald">In offer workflow</Pill> : null}
                {event.kind === 'offer' && !offerCaptured ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canManageSales}
                    onClick={() => {
                      const result = captureBuyerRoomOffer(event.id);
                      setSyncMessage(result.message);
                    }}
                  >
                    Send to offer workflow
                  </Button>
                ) : null}
                {event.kind === 'packet-downloaded' && packetDownloadLead?.nextFollowUp ? (
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/follow-ups?lead=${packetDownloadLead.id}`}>Open follow-up</Link>
                  </Button>
                ) : null}
                {event.kind === 'packet-downloaded' && !packetDownloadLead?.nextFollowUp ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canManageSales}
                    onClick={() => {
                      const result = captureBuyerRoomFollowUp(event.id);
                      setSyncMessage(result.message);
                    }}
                  >
                    Schedule follow-up
                  </Button>
                ) : null}
                {needsResponse ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canManageSales || respondingEventId === event.id}
                    onClick={async () => {
                      const note = event.kind === 'proof-requested' ? `Proof request from ${event.actor} marked sent.` : `Request from ${event.actor} marked answered.`;
                      setRespondingEventId(event.id);
                      const cloudResult = await recordBuyerRoomSellerResponseInCloud({ replyToEventId: event.id, note });
                      setRespondingEventId('');
                      if (!cloudResult.ok) {
                        setSyncMessage(cloudResult.message);
                        return;
                      }
                      if (cloudResult.cloudAttempted) {
                        if (cloudResult.event) {
                          mergeBuyerRoomEvents([cloudResult.event]);
                        } else {
                          await refresh(false);
                        }
                        setSyncMessage(cloudResult.message);
                        return;
                      }
                      const localResult = logBuyerRoomEvent({
                        horseId: event.horseId,
                        kind: 'seller-response',
                        actor: currentRole,
                        replyToEventId: event.id,
                        note,
                      });
                      setSyncMessage(localResult.message);
                    }}
                  >
                    {respondingEventId === event.id ? 'Recording...' : event.kind === 'proof-requested' ? 'Mark proof sent' : 'Mark answered'}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    ) : (
      <div className="stack-list">
        <div className="stack-item">
          <div className="stack-item__title">{emptyTitle}</div>
          <div className="stack-item__copy">{emptyDescription}</div>
        </div>
      </div>
    )
  );

  return (
    <Panel
      eyebrow="Buyer response queue"
      title="Buyer activity"
      description="Questions, proof requests, offers, packet downloads, scheduled follow-ups, and seller responses from shared buyer links."
      meta={<Pill tone={openRequests.length ? 'amber' : activity.length ? 'blue' : 'slate'}>{openRequests.length ? `${openRequests.length} response needed` : activity.length ? 'Activity current' : 'Quiet'}</Pill>}
      action={<Button variant="outline" size="sm" disabled={syncing} onClick={() => void refresh()}>{syncing ? 'Refreshing...' : 'Refresh activity'}</Button>}
    >
      <Tabs defaultValue={openRequests.length ? 'responses' : 'activity'}>
        <TabsList>
          <TabsTrigger value="responses">Needs response ({openRequests.length})</TabsTrigger>
          <TabsTrigger value="activity">All activity ({activity.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="responses">
          {renderEvents(openRequests, 'No buyer requests waiting', 'New buyer questions, call requests, and proof requests will appear here.')}
        </TabsContent>
        <TabsContent value="activity">
          {renderEvents(activity, 'No buyer activity yet', 'Share a buyer packet to begin tracking views, requests, and offers.')}
        </TabsContent>
      </Tabs>
      {syncMessage ? <p className="panel__description" role="status" style={{ marginTop: 12 }}>{syncMessage}</p> : null}
    </Panel>
  );
}
