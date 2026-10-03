import { useCallback, useLayoutEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useCloudStore } from '@/store/useCloudStore';
import { useXbarStore } from '@/store/useXbarStore';
import { hasRoleCapability } from '@/lib/permissions';
import { createPhotoSelectionGate, type PhotoSelectionScope, type PhotoSelectionTicket } from '@/lib/photoSelection';

export function useHorsePhotoSelection(horseId: string | undefined) {
  const location = useLocation();
  const [gate] = useState(createPhotoSelectionGate);
  const [ticket, setTicket] = useState<PhotoSelectionTicket | null>(null);
  const readScope = useCallback((): PhotoSelectionScope | null => {
    const state = useXbarStore.getState();
    const cloud = useCloudStore.getState();
    const horse = state.horses.find((record) => record.id === horseId);
    if (!horse || !hasRoleCapability(state.currentRole, 'uploadMedia')) return null;
    return {
      horseId: horse.id,
      routeKey: location.key,
      // Read the live URL too, so navigation is detected before React commits.
      routeUrl: window.location.href,
      accountId: cloud.session?.user?.id ?? '',
      workspaceId: cloud.workspaceId ?? '',
      role: state.currentRole,
      workspaceRecord: state.workspaceProfile,
      horseRecord: horse,
    };
  }, [horseId, location.key]);

  const cancel = useCallback(() => {
    gate.invalidate();
    setTicket(null);
  }, [gate]);

  useLayoutEffect(() => {
    const reconcile = () => {
      if (gate.reconcile(readScope())) setTicket(null);
    };
    // Synchronous subscriptions catch account/role/workspace/reset ABA changes
    // even when React batches them into one render with the original values.
    const unsubscribeWorkspace = useXbarStore.subscribe(reconcile);
    const unsubscribeCloud = useCloudStore.subscribe(reconcile);
    window.addEventListener('popstate', cancel);
    window.addEventListener('hashchange', cancel);
    return () => {
      unsubscribeWorkspace();
      unsubscribeCloud();
      window.removeEventListener('popstate', cancel);
      window.removeEventListener('hashchange', cancel);
      // Route-key changes and unmount revoke callbacks from the old DOM input.
      cancel();
    };
  }, [cancel, gate, readScope]);

  return {
    ticket,
    open() {
      const scope = readScope();
      if (scope) setTicket(gate.open(scope));
    },
    cancel,
    consume(selection: PhotoSelectionTicket) {
      const targetHorseId = gate.consume(selection, readScope());
      setTicket((current) => (current === selection ? null : current));
      return targetHorseId;
    },
  };
}
