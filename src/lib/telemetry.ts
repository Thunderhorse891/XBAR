/**
 * Unified client telemetry stream.
 *
 * Every product surface should emit through `track()` so the event stream is
 * consistent (workspace-scoped, namespaced names, single dispatch path) instead
 * of each call site re-deriving the workspace id and calling the low-level
 * `trackRuntimeEvent` directly.
 */
import { trackRuntimeEvent, type RuntimeEventSeverity } from '@/lib/runtimeEvents';
import { useCloudStore } from '@/store/useCloudStore';

/** Canonical, namespaced event names for the operations app. */
export const events = {
  pageView: 'navigation.page_view',

  createOpened: 'create.menu_opened',
  createSubmitted: 'create.submitted',

  taskOpened: 'task.opened',
  taskCompleted: 'task.completed',
  taskBulkCompleted: 'task.bulk_completed',

  blockerOpened: 'sale.blocker_opened',
  blockerResolved: 'sale.blocker_resolved',
  packetStepAdvanced: 'sale.packet_step_advanced',
  packetShared: 'sale.packet_shared',

  buyerSelected: 'buyer.selected',
  buyerAccessRevoked: 'buyer.access_revoked',
  buyerOfferRecorded: 'buyer.offer_recorded',

  documentOpened: 'document.opened',
  documentMarkedSafe: 'document.marked_buyer_safe',
  documentBulkAction: 'document.bulk_action',

  animalProfileOpened: 'animal.profile_opened',
  locationOpened: 'pasture.location_opened',
  planSelected: 'billing.plan_selected',
} as const;

export type TrackedEvent = (typeof events)[keyof typeof events];

/**
 * Emit a telemetry event. Workspace id is resolved from the cloud store so
 * callers never have to thread it through. Fire-and-forget; never throws.
 */
export function track(
  eventName: TrackedEvent | string,
  payload: Record<string, unknown> = {},
  severity: RuntimeEventSeverity = 'info',
) {
  let workspaceId: string | undefined;
  try {
    workspaceId = useCloudStore.getState().workspaceId || undefined;
  } catch {
    workspaceId = undefined;
  }
  void trackRuntimeEvent({ workspaceId, eventName, severity, payload });
}
