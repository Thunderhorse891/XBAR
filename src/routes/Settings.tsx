import { useEffect, useRef, useState } from 'react';
import { PageHeader, Panel, Pill } from '@/components/app-ui';
import { formatDateLabel } from '@/lib/format';
import { loadWorkspaceBackupFromCloud, saveWorkspaceBackupToCloud } from '@/lib/cloudWorkspace';
import { isBillingConfigured, isFacebookSharingConfigured, isRelationalCloudEnabled, isSupabaseConfigured, isSnapshotFallbackEnabled } from '@/lib/platformConfig';
import { workspaceStorageDriverLabel } from '@/lib/workspaceStorage';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
import type { UserRole } from '@/types/xbar';

function roleLabel(role: UserRole) {
  return role === 'Owner' ? 'Horse Owner / Client' : role;
}

export default function Settings() {
  const roleWorkspaces = useXbarStore((state) => state.roleWorkspaces);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const workspaceMembers = useXbarStore((state) => state.workspaceMembers);
  const workspaceInvitations = useXbarStore((state) => state.workspaceInvitations);
  const subscription = useXbarStore((state) => state.subscription);
  const updateWorkspaceProfile = useXbarStore((state) => state.updateWorkspaceProfile);
  const inviteWorkspaceMember = useXbarStore((state) => state.inviteWorkspaceMember);
  const revokeWorkspaceInvitation = useXbarStore((state) => state.revokeWorkspaceInvitation);
  const activateWorkspaceInvitation = useXbarStore((state) => state.activateWorkspaceInvitation);
  const removeWorkspaceMember = useXbarStore((state) => state.removeWorkspaceMember);
  const exportWorkspaceBackup = useXbarStore((state) => state.exportWorkspaceBackup);
  const importWorkspaceBackup = useXbarStore((state) => state.importWorkspaceBackup);
  const cloudStatus = useCloudStore((state) => state.status);
  const cloudSession = useCloudStore((state) => state.session);
  const workspaceId = useCloudStore((state) => state.workspaceId);
  const lastCloudSyncAt = useCloudStore((state) => state.lastSyncAt);
  const cloudSyncState = useCloudStore((state) => state.syncState);
  const setLastCloudSyncAt = useCloudStore((state) => state.setLastSyncAt);
  const sendMagicLink = useCloudStore((state) => state.sendMagicLink);
  const signInWithFacebook = useCloudStore((state) => state.signInWithFacebook);
  const signOutCloud = useCloudStore((state) => state.signOut);
  const pushToast = useUiStore((state) => state.pushToast);
  const canManageSettings = useCurrentRoleCapability('manageSettings');
  const canSyncCloud = useCurrentRoleCapability('syncCloud');
  const importRef = useRef<HTMLInputElement | null>(null);
  const [profileDraft, setProfileDraft] = useState(workspaceProfile);
  const [authEmail, setAuthEmail] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('Owner');
  const [cloudBusy, setCloudBusy] = useState(false);
  const facebookConnected = cloudSession?.user?.app_metadata?.provider === 'facebook';
  const activeMembers = workspaceMembers.filter((member) => member.status === 'Active');
  const pendingInvites = workspaceInvitations.filter((invite) => invite.status === 'Pending');

  useEffect(() => {
    setProfileDraft(workspaceProfile);
  }, [workspaceProfile]);

  const handleExport = () => {
    try {
      const backup = exportWorkspaceBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `xbar-workspace-${backup.exportedAt.slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      pushToast({
        title: 'Backup exported',
        message: 'Ranch backup downloaded successfully.',
        tone: 'success',
      });
    } catch (error) {
      console.error('Backup export failed', error);
      pushToast({
        title: 'Backup failed',
        message: 'The ranch backup could not be exported.',
        tone: 'error',
      });
    }
  };

  const handleImport = async (file?: File) => {
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const result = importWorkspaceBackup(JSON.parse(text));
      pushToast({
        title: result.ok ? 'Backup imported' : 'Import blocked',
        message: result.message,
        tone: result.ok ? 'success' : 'error',
      });
    } catch (error) {
      console.error('Backup import failed', error);
      pushToast({
        title: 'Import failed',
        message: 'Choose a valid XBAR backup JSON file.',
        tone: 'error',
      });
    } finally {
      if (importRef.current) {
        importRef.current.value = '';
      }
    }
  };

  const handleProfileSave = () => {
    if (!profileDraft.ranchName.trim() || !profileDraft.businessName.trim()) {
      pushToast({
        title: 'Profile not saved',
        message: 'Business name and ranch name are required.',
        tone: 'error',
      });
      return;
    }

    if (profileDraft.operationsEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileDraft.operationsEmail.trim())) {
      pushToast({
        title: 'Profile not saved',
        message: 'Operations email must be a valid address.',
        tone: 'error',
      });
      return;
    }

    const result = updateWorkspaceProfile(profileDraft);
    pushToast({
      title: result.ok ? 'Profile saved' : 'Profile not saved',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
  };

  const handleSendMagicLink = async () => {
    setCloudBusy(true);
    const result = await sendMagicLink(authEmail);
    pushToast({
      title: result.ok ? 'Magic link sent' : 'Sign-in blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    setCloudBusy(false);
  };

  const handlePushCloud = async () => {
    setCloudBusy(true);
    const result = await saveWorkspaceBackupToCloud(exportWorkspaceBackup());
    pushToast({
      title: result.ok ? 'Cloud sync complete' : 'Cloud sync failed',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    if (result.ok && result.updatedAt) {
      setLastCloudSyncAt(result.updatedAt);
    }
    setCloudBusy(false);
  };

  const handlePullCloud = async () => {
    setCloudBusy(true);
    const remote = await loadWorkspaceBackupFromCloud();
    if (!remote.ok) {
      pushToast({
        title: 'Cloud pull failed',
        message: remote.message,
        tone: 'error',
      });
      setCloudBusy(false);
      return;
    }

    const result = importWorkspaceBackup(remote.backup);
    pushToast({
      title: result.ok ? 'Cloud workspace loaded' : 'Cloud import blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    if (result.ok && remote.updatedAt) {
      setLastCloudSyncAt(remote.updatedAt);
    }
    setCloudBusy(false);
  };

  const handleSignOutCloud = async () => {
    setCloudBusy(true);
    const result = await signOutCloud();
    pushToast({
      title: result.ok ? 'Signed out' : 'Sign-out failed',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    setCloudBusy(false);
  };

  const handleFacebookConnect = async () => {
    setCloudBusy(true);
    const result = await signInWithFacebook();
    pushToast({
      title: result.ok ? 'Facebook connect started' : 'Facebook connect failed',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    setCloudBusy(false);
  };

  const handleInviteMember = async () => {
    const result = await inviteWorkspaceMember(inviteEmail, inviteRole);
    pushToast({
      title: result.ok ? 'Invite created' : 'Invite blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    if (result.ok) {
      setInviteEmail('');
      setInviteRole('Owner');
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Settings"
      />

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Cloud" title="Cloud">
          {isSupabaseConfigured() ? (
            cloudSession ? (
              <>
                <div className="stack-list">
                  <div className="stack-item">
                    <div className="stack-item__top">
                      <div className="stack-item__title">{cloudSession.user.email ?? 'Signed-in user'}</div>
                      <div className="status-inline">
                        <Pill tone="emerald">{cloudStatus === 'signed-in' ? 'Connected' : 'Ready'}</Pill>
                        <Pill tone={cloudSyncState === 'error' ? 'rose' : cloudSyncState === 'syncing' ? 'amber' : 'blue'}>
                          {cloudSyncState === 'syncing' ? 'Syncing' : cloudSyncState === 'error' ? 'Sync issue' : 'Autosave on'}
                        </Pill>
                      </div>
                    </div>
                    <div className="inline-metrics">
                      <span>{workspaceId ? `Ranch ${workspaceId.slice(0, 8)}` : `User ${cloudSession.user.id.slice(0, 8)}`}</span>
                      <span>{lastCloudSyncAt ? `Last sync ${formatDateLabel(lastCloudSyncAt)}` : 'No cloud sync yet'}</span>
                      <span>{cloudSyncState === 'syncing' ? 'Saving relational records' : cloudSyncState === 'error' ? 'Needs retry' : 'Watching workspace changes'}</span>
                    </div>
                  </div>
                </div>
                <div className="inline-actions">
                  <button className="button button--primary button--compact" type="button" onClick={handlePushCloud} disabled={!canSyncCloud || cloudBusy}>
                    {cloudBusy ? 'Working...' : 'Push cloud'}
                  </button>
                  <button className="button button--ghost button--compact" type="button" onClick={handlePullCloud} disabled={!canSyncCloud || cloudBusy}>
                    Pull cloud
                  </button>
                  <button className="button button--ghost button--compact" type="button" onClick={handleSignOutCloud} disabled={!canSyncCloud || cloudBusy}>
                    Sign out
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="form-grid form-grid--tight">
                  <label className="field-stack">
                    <span className="field-label">Email</span>
                    <input className="field-input" type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} disabled={!canSyncCloud} />
                  </label>
                </div>
                <div className="inline-actions">
                  <button className="button button--primary button--compact" type="button" onClick={handleSendMagicLink} disabled={!canSyncCloud || cloudBusy || !authEmail.trim()}>
                    {cloudBusy ? 'Sending...' : 'Send magic link'}
                  </button>
                </div>
              </>
            )
          ) : (
            <div className="bullet-list">
              <div className="bullet-list__item">Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to turn on cloud auth and sync.</div>
              <div className="bullet-list__item">Until then, this ranch data stays local to this browser.</div>
            </div>
          )}
        </Panel>

        <Panel eyebrow="Ranch profile" title="Profile">
          <div className="form-grid form-grid--tight">
            <label className="field-stack">
              <span className="field-label">Business name</span>
              <input className="field-input" value={profileDraft.businessName} onChange={(event) => setProfileDraft((current) => ({ ...current, businessName: event.target.value }))} disabled={!canManageSettings} />
            </label>
            <label className="field-stack">
              <span className="field-label">Ranch name</span>
              <input className="field-input" value={profileDraft.ranchName} onChange={(event) => setProfileDraft((current) => ({ ...current, ranchName: event.target.value }))} disabled={!canManageSettings} />
            </label>
            <label className="field-stack">
              <span className="field-label">Default owner</span>
              <input className="field-input" value={profileDraft.defaultOwnerName} onChange={(event) => setProfileDraft((current) => ({ ...current, defaultOwnerName: event.target.value }))} disabled={!canManageSettings} />
            </label>
            <label className="field-stack">
              <span className="field-label">Default owner entity</span>
              <input className="field-input" value={profileDraft.defaultOwnerEntity} onChange={(event) => setProfileDraft((current) => ({ ...current, defaultOwnerEntity: event.target.value }))} disabled={!canManageSettings} />
            </label>
            <label className="field-stack">
              <span className="field-label">Ranch manager</span>
              <input className="field-input" value={profileDraft.ranchManagerName} onChange={(event) => setProfileDraft((current) => ({ ...current, ranchManagerName: event.target.value }))} disabled={!canManageSettings} />
            </label>
            <label className="field-stack">
              <span className="field-label">Operations email</span>
              <input className="field-input" type="email" value={profileDraft.operationsEmail} onChange={(event) => setProfileDraft((current) => ({ ...current, operationsEmail: event.target.value }))} disabled={!canManageSettings} />
            </label>
            <label className="field-stack">
              <span className="field-label">Default barn</span>
              <input className="field-input" value={profileDraft.defaultBarn} onChange={(event) => setProfileDraft((current) => ({ ...current, defaultBarn: event.target.value }))} disabled={!canManageSettings} />
            </label>
            <label className="field-stack">
              <span className="field-label">Default pasture</span>
              <input className="field-input" value={profileDraft.defaultPasture} onChange={(event) => setProfileDraft((current) => ({ ...current, defaultPasture: event.target.value }))} disabled={!canManageSettings} />
            </label>
          </div>
          <div className="inline-actions">
            <button className="button button--primary button--compact" type="button" onClick={handleProfileSave} disabled={!canManageSettings}>
              Save profile
            </button>
          </div>
        </Panel>

        <Panel eyebrow="Ranch access" title="Access">
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Seats</div>
                <div className="status-inline">
                  <Pill tone={subscription.usage.seatsUsed >= subscription.usage.seatLimit ? 'rose' : 'blue'}>
                    {subscription.usage.seatsUsed}/{subscription.usage.seatLimit}
                  </Pill>
                  <Pill tone={subscription.usage.sharedAccessSeatsUsed >= subscription.usage.sharedAccessSeatLimit && subscription.usage.sharedAccessSeatLimit > 0 ? 'rose' : 'emerald'}>
                    {subscription.usage.sharedAccessSeatsUsed}/{subscription.usage.sharedAccessSeatLimit} shared
                  </Pill>
                </div>
              </div>
              <div className="inline-metrics">
                <span>{activeMembers.length} active members</span>
                <span>{pendingInvites.length} pending invites</span>
                <span>{isSupabaseConfigured() ? 'Matching email sign-in accepts invites automatically' : 'Browser access can confirm invites manually'}</span>
              </div>
            </div>
          </div>

          <div className="form-grid form-grid--tight">
            <label className="field-stack">
              <span className="field-label">Invite email</span>
              <input className="field-input" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} disabled={!canManageSettings} />
            </label>
            <label className="field-stack">
              <span className="field-label">Role</span>
              <select className="field-input" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as UserRole)} disabled={!canManageSettings}>
                <option value="Admin">Admin</option>
                <option value="Ranch Manager">Ranch Manager</option>
                <option value="Owner">Horse Owner / Client</option>
                <option value="Medical Lead">Medical Lead</option>
                <option value="Sales Lead">Sales Lead</option>
              </select>
            </label>
          </div>

          <div className="inline-actions">
            <button className="button button--primary button--compact" type="button" onClick={handleInviteMember} disabled={!canManageSettings || !inviteEmail.trim()}>
              Invite member
            </button>
          </div>

          <div className="detail-grid">
            <div className="panel panel--nested">
              <div className="panel__header panel__header--compact">
                <div>
                  <div className="panel__eyebrow">Members</div>
                  <h3 className="panel__title">Active team</h3>
                </div>
              </div>
              <div className="stack-list">
                {activeMembers.length ? activeMembers.map((member) => (
                  <div key={member.id} className="stack-item">
                    <div className="stack-item__top">
                      <div>
                        <div className="stack-item__title">{member.email}</div>
                        <div className="stack-item__copy">
                          {roleLabel(member.role)} · {member.source === 'Owner' ? 'Ranch owner' : `Joined ${formatDateLabel(member.joinedAt)}`}
                        </div>
                      </div>
                      <div className="status-inline">
                        <Pill tone={member.role === 'Admin' ? 'blue' : member.role === 'Owner' ? 'emerald' : 'slate'}>{roleLabel(member.role)}</Pill>
                        <Pill tone="emerald">Active</Pill>
                      </div>
                    </div>
                    <div className="inline-actions">
                      <button
                        className="button button--ghost button--compact"
                        type="button"
                        onClick={async () => {
                          const result = await removeWorkspaceMember(member.id);
                          pushToast({
                            title: result.ok ? 'Member removed' : 'Removal blocked',
                            message: result.message,
                            tone: result.ok ? 'success' : 'error',
                          });
                        }}
                        disabled={!canManageSettings}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )) : (
                  <div className="stack-item">
                    <div className="stack-item__copy">No active members yet.</div>
                  </div>
                )}
              </div>
            </div>

            <div className="panel panel--nested">
              <div className="panel__header panel__header--compact">
                <div>
                  <div className="panel__eyebrow">Invites</div>
                  <h3 className="panel__title">Pending</h3>
                </div>
              </div>
              <div className="stack-list">
                {pendingInvites.length ? pendingInvites.map((invite) => (
                  <div key={invite.id} className="stack-item">
                    <div className="stack-item__top">
                      <div>
                        <div className="stack-item__title">{invite.email}</div>
                        <div className="stack-item__copy">
                          {roleLabel(invite.role)} · Sent {formatDateLabel(invite.invitedAt)}
                        </div>
                      </div>
                      <Pill tone={invite.role === 'Owner' ? 'emerald' : 'blue'}>{roleLabel(invite.role)}</Pill>
                    </div>
                    <div className="stack-item__copy" style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--muted)', wordBreak: 'break-all' }}>
                      Invite code: {invite.id}
                    </div>
                    <div className="inline-actions">
                      <button
                        className="button button--ghost button--compact"
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(invite.id).then(() => {
                            pushToast({ title: 'Invite code copied', message: 'Share this code with the invitee so they can join the workspace.', tone: 'success' });
                          });
                        }}
                      >
                        Copy code
                      </button>
                      {!isSupabaseConfigured() ? (
                        <button
                          className="button button--ghost button--compact"
                          type="button"
                          onClick={() => {
                            const result = activateWorkspaceInvitation(invite.id);
                            pushToast({
                              title: result.ok ? 'Invite activated' : 'Activation blocked',
                              message: result.message,
                              tone: result.ok ? 'success' : 'error',
                            });
                          }}
                          disabled={!canManageSettings}
                        >
                          Mark joined
                        </button>
                      ) : null}
                      <button
                        className="button button--ghost button--compact"
                        type="button"
                        onClick={async () => {
                          const result = await revokeWorkspaceInvitation(invite.id);
                          pushToast({
                            title: result.ok ? 'Invite revoked' : 'Revoke blocked',
                            message: result.message,
                            tone: result.ok ? 'success' : 'error',
                          });
                        }}
                        disabled={!canManageSettings}
                      >
                        Revoke
                      </button>
                    </div>
                  </div>
                )) : (
                  <div className="stack-item">
                    <div className="stack-item__copy">No invites are holding seats right now.</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Panel>

        <Panel eyebrow="Role matrix" title="Roles">
          <div className="stack-list">
            {roleWorkspaces.map((workspace) => (
              <div key={workspace.role} className="stack-item">
                <div className="stack-item__top">
                  <div className="stack-item__title">{workspace.role}</div>
                  <Pill tone="blue">{workspace.primaryModules.length} modules</Pill>
                </div>
                <div className="token-row">
                  {workspace.permissions.map((permission) => (
                    <Pill key={permission}>{permission}</Pill>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel eyebrow="Channels" title="Facebook">
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Share dialog</div>
                <div className="status-inline">
                  <Pill tone={isFacebookSharingConfigured() ? 'emerald' : 'slate'}>
                    {isFacebookSharingConfigured() ? 'Configured' : 'App ID missing'}
                  </Pill>
                  <Pill tone={facebookConnected ? 'emerald' : 'slate'}>
                    {facebookConnected ? 'Connected' : 'Not connected'}
                  </Pill>
                </div>
              </div>
              <div className="inline-metrics">
                <span>Sale listing links can open in Facebook</span>
                <span>Post flow uses Facebook&apos;s own share window</span>
              </div>
            </div>
          </div>
          <div className="inline-actions">
            <button
              className="button button--primary button--compact"
              type="button"
              onClick={handleFacebookConnect}
              disabled={!canSyncCloud || cloudBusy || !isSupabaseConfigured()}
            >
              {facebookConnected ? 'Reconnect Facebook' : 'Connect Facebook'}
            </button>
          </div>
        </Panel>

        <Panel eyebrow="Runtime" title="Capabilities">
          <div className="token-row">
            <Pill tone={isSupabaseConfigured() ? 'blue' : 'slate'}>{isSupabaseConfigured() ? 'Cloud auth on' : 'Cloud auth off'}</Pill>
            <Pill tone={cloudSession ? 'emerald' : 'slate'}>{cloudSession ? 'Cloud session live' : 'Local session'}</Pill>
            <Pill tone={isRelationalCloudEnabled() ? 'emerald' : 'slate'}>
              {isRelationalCloudEnabled() ? 'Relational sync on' : 'Snapshot-only sync'}
            </Pill>
            <Pill tone={isSnapshotFallbackEnabled() ? 'blue' : 'slate'}>{isSnapshotFallbackEnabled() ? 'Snapshot fallback on' : 'Snapshot fallback off'}</Pill>
              <Pill tone={isBillingConfigured() ? 'emerald' : 'slate'}>{isBillingConfigured() ? 'Managed billing live' : 'Managed billing paused'}</Pill>
            <Pill tone={isFacebookSharingConfigured() ? 'emerald' : 'slate'}>{isFacebookSharingConfigured() ? 'Facebook share live' : 'Facebook share off'}</Pill>
            <Pill tone="blue">{workspaceStorageDriverLabel}</Pill>
            <Pill tone="slate">Review queue</Pill>
          </div>
        </Panel>
      </div>

      <Panel eyebrow="Ranch backup" title="Backups">
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => void handleImport(event.target.files?.[0])}
        />
        <div className="stack-list">
          <div className="stack-item">
            <div className="stack-item__top">
              <div className="stack-item__title">Storage driver</div>
              <Pill tone="blue">{workspaceStorageDriverLabel}</Pill>
            </div>
          </div>
        </div>
        <div className="inline-actions">
          <button className="button button--primary button--compact" type="button" onClick={handleExport} disabled={!canManageSettings}>
            Export backup
          </button>
          <button className="button button--ghost button--compact" type="button" onClick={() => importRef.current?.click()} disabled={!canManageSettings}>
            Import backup
          </button>
        </div>
      </Panel>
    </>
  );
}
