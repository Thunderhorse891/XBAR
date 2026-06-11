'use client';

import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Shield, UploadCloud, UserPlus } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CommandCard } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MicroLabel } from '@/components/shared/status';
import {
  useActivity,
  useBarnMembers,
  useBranding,
  useInviteBarnMember,
  useUpdateBranding,
} from '@/hooks/queries';
import { formatDateTime } from '@/lib/utils';
import type { BarnMember } from '@/lib/types';

const ROLE_BADGES: Record<BarnMember['role'], { label: string; variant: 'blue' | 'steel' | 'verified' | 'pending' }> = {
  owner: { label: 'Owner', variant: 'blue' },
  trainer: { label: 'Trainer', variant: 'steel' },
  vet: { label: 'Vet', variant: 'verified' },
  'barn-hand': { label: 'Barn hand', variant: 'steel' },
};

const inviteSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  role: z.enum(['trainer', 'vet', 'barn-hand']),
});

type InviteValues = z.infer<typeof inviteSchema>;

export default function BarnSettingsPage() {
  const { data: members } = useBarnMembers();
  const { data: activity } = useActivity();
  const { data: branding } = useBranding();
  const inviteMember = useInviteBarnMember();
  const updateBranding = useUpdateBranding();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [activityUser, setActivityUser] = useState('all');
  const [primaryColor, setPrimaryColor] = useState<string | null>(null);
  const [secondaryColor, setSecondaryColor] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteValues>({ resolver: zodResolver(inviteSchema), defaultValues: { role: 'trainer' } });

  const users = useMemo(() => [...new Set((activity ?? []).map((entry) => entry.user))], [activity]);
  const filteredActivity = (activity ?? []).filter((entry) => activityUser === 'all' || entry.user === activityUser);

  const effectivePrimary = primaryColor ?? branding?.primaryColor ?? '#18A8FF';
  const effectiveSecondary = secondaryColor ?? branding?.secondaryColor ?? '#11151B';

  const sendInvite = handleSubmit(async (values) => {
    await inviteMember.mutateAsync(values);
    reset();
    setInviteOpen(false);
  });

  return (
    <>
      <Header title="Barn Settings" />
      <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        {/* Dark command summary */}
        <CommandCard className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <MicroLabel className="text-steel-strong">Barn command</MicroLabel>
              <h2 className="mt-1 text-xl font-semibold text-heading">{branding?.barnName ?? 'Barn operations'}</h2>
              <p className="mt-1 text-sm text-steel-muted">
                {(members ?? []).filter((member) => member.status === 'active').length} active members ·{' '}
                {(members ?? []).filter((member) => member.status === 'invited').length} pending invites · Business plan
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-blueline bg-accent-glow px-3 py-2">
              <Shield className="h-4 w-4 text-accent" aria-hidden />
              <span className="text-xs font-medium text-surface">All access is role-scoped and audit logged</span>
            </div>
          </div>
        </CommandCard>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Team roles</CardTitle>
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus aria-hidden /> Invite user
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(members ?? []).map((member) => (
                  <TableRow key={member.id}>
                    <TableCell>
                      <p className="font-medium">{member.name}</p>
                      <p className="text-xs text-steel-muted">{member.email}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={ROLE_BADGES[member.role].variant}>{ROLE_BADGES[member.role].label}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={member.status === 'active' ? 'verified' : 'pending'}>{member.status}</Badge>
                    </TableCell>
                    <TableCell className="text-steel-muted">
                      {member.lastActiveAt ? formatDateTime(member.lastActiveAt) : 'Invite pending'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Owner portal</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-ink">Clients see their own horses only</p>
              <p className="text-sm text-gunmetal">
                When on, owner accounts are scoped to horses they own — barn financials and other clients stay hidden.
              </p>
            </div>
            <Switch
              checked={branding?.ownerPortalRestricted ?? true}
              onCheckedChange={(checked) => updateBranding.mutate({ ownerPortalRestricted: checked })}
              aria-label="Restrict owner portal to own horses"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Activity log</CardTitle>
            <Select aria-label="Filter by user" className="w-48" value={activityUser} onChange={(event) => setActivityUser(event.target.value)}>
              <option value="all">All users</option>
              {users.map((user) => (
                <option key={user} value={user}>{user}</option>
              ))}
            </Select>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Horse</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredActivity.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium">{entry.user}</TableCell>
                    <TableCell>{entry.action} <span className="text-steel-muted">· {entry.entity}</span></TableCell>
                    <TableCell>{entry.horseName ?? '—'}</TableCell>
                    <TableCell className="text-steel-muted">{formatDateTime(entry.occurredAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Branding</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="brand-logo">Logo</Label>
                <label
                  htmlFor="brand-logo"
                  className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-steel p-4 text-sm text-gunmetal hover:border-accent"
                >
                  <UploadCloud className="h-5 w-5 text-accent-strong" aria-hidden />
                  {branding?.logoFileName ?? 'Upload PNG or SVG, max 2 MB'}
                </label>
                <input
                  id="brand-logo"
                  type="file"
                  accept=".png,.svg"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) updateBranding.mutate({ logoFileName: file.name });
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="brand-primary">Primary color</Label>
                  <div className="flex items-center gap-2">
                    <input
                      id="brand-primary"
                      type="color"
                      value={effectivePrimary}
                      onChange={(event) => setPrimaryColor(event.target.value)}
                      className="h-10 w-12 cursor-pointer rounded border border-steel bg-surface"
                    />
                    <Input aria-label="Primary color hex" value={effectivePrimary} onChange={(event) => setPrimaryColor(event.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="brand-secondary">Secondary color</Label>
                  <div className="flex items-center gap-2">
                    <input
                      id="brand-secondary"
                      type="color"
                      value={effectiveSecondary}
                      onChange={(event) => setSecondaryColor(event.target.value)}
                      className="h-10 w-12 cursor-pointer rounded border border-steel bg-surface"
                    />
                    <Input aria-label="Secondary color hex" value={effectiveSecondary} onChange={(event) => setSecondaryColor(event.target.value)} />
                  </div>
                </div>
              </div>
              <Button
                onClick={() => updateBranding.mutate({ primaryColor: effectivePrimary, secondaryColor: effectiveSecondary })}
                disabled={updateBranding.isPending}
              >
                {updateBranding.isPending ? 'Saving…' : 'Save branding'}
              </Button>
            </div>
            {/* Live preview */}
            <div aria-label="Branding preview" className="rounded-lg border border-steel/40 p-4" style={{ backgroundColor: effectiveSecondary }}>
              <MicroLabel className="text-steel-strong">Owner portal preview</MicroLabel>
              <div className="mt-3 rounded-md bg-surface p-4">
                <p className="text-sm font-semibold text-ink">{branding?.barnName ?? 'Your barn'}</p>
                <p className="text-xs text-gunmetal">Welcome back — here are your horses.</p>
                <button
                  type="button"
                  className="mt-3 rounded-md px-3 py-1.5 text-xs font-semibold text-white"
                  style={{ backgroundColor: effectivePrimary }}
                >
                  View documents
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a team member</DialogTitle>
            <DialogDescription>They receive an email link scoped to the selected role.</DialogDescription>
          </DialogHeader>
          <form onSubmit={sendInvite} noValidate className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" type="email" placeholder="trainer@barn.com" {...register('email')} aria-invalid={Boolean(errors.email)} />
              {errors.email && <p role="alert" className="text-xs text-danger">{errors.email.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <Select id="invite-role" {...register('role')}>
                <option value="trainer">Trainer — assigned horses, schedules, notes</option>
                <option value="vet">Vet — granted horses, health records only</option>
                <option value="barn-hand">Barn hand — daily care logging</option>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={inviteMember.isPending}>{inviteMember.isPending ? 'Sending…' : 'Send invite'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
