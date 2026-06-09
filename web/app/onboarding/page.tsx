'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { BellRing, FileScan, PartyPopper, UserPlus } from 'lucide-react';
import { HorseheadIcon } from '@/components/layout/horsehead-icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { MicroLabel } from '@/components/shared/status';
import { DropZone } from '@/components/documents/drop-zone';
import { useCreateHorse, useInviteBarnMember } from '@/hooks/queries';
import { markOnboarded } from '@/lib/auth';
import { useSubscriptionStore } from '@/stores/subscription';
import { useEffect } from 'react';

const STEPS = ['First horse', 'Tour', 'Reminders', 'Team'] as const;

export default function OnboardingPage() {
  const router = useRouter();
  const createHorse = useCreateHorse();
  const inviteMember = useInviteBarnMember();
  const { hydrate, atLeast, hydrated } = useSubscriptionStore();
  const [step, setStep] = useState(0);
  const [horseName, setHorseName] = useState('');
  const [horseBreed, setHorseBreed] = useState('');
  const [uploadNote, setUploadNote] = useState('');
  const [createdHorse, setCreatedHorse] = useState(false);
  const [prefs, setPrefs] = useState({ coggins: true, vaccines: true, email: true, text: false });
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'trainer' | 'vet' | 'barn-hand'>('trainer');
  const [invited, setInvited] = useState<string[]>([]);

  useEffect(() => hydrate(), [hydrate]);
  const showTeamStep = !hydrated || atLeast('business');
  const totalSteps = showTeamStep ? STEPS.length : STEPS.length - 1;

  const finish = () => {
    markOnboarded();
    router.push('/dashboard');
  };

  const next = () => {
    if (step + 1 >= totalSteps) finish();
    else setStep(step + 1);
  };

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <a href="#onboarding-main" className="skip-link">Skip to content</a>

      {/* Dark progress header with electric blue bar */}
      <header className="bg-shell px-4 py-4 sm:px-8">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <p className="text-base font-bold text-heading">XBAR<span className="text-accent">.</span></p>
          <div className="flex items-center gap-4">
            <MicroLabel className="text-steel-strong">Step {step + 1} of {totalSteps}</MicroLabel>
            <Button variant="ghost" size="sm" className="text-steel-muted hover:text-surface" onClick={finish}>
              Skip setup
            </Button>
          </div>
        </div>
        <div className="mx-auto mt-3 max-w-2xl">
          <Progress value={((step + 1) / totalSteps) * 100} aria-label="Onboarding progress" />
        </div>
      </header>

      <main id="onboarding-main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-8">
        <motion.div key={step} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25 }}>
          {step === 0 && (
            <section aria-labelledby="step-horse">
              <MicroLabel className="text-accent-strong">Step 1 · Your first horse</MicroLabel>
              <h1 id="step-horse" className="mt-2 text-2xl font-semibold text-ink">Add your first horse</h1>
              <p className="mt-1 text-sm text-gunmetal">Enter the basics — or upload registration papers and let OCR do it.</p>

              <div className="mt-6 grid gap-5 md:grid-cols-2">
                <form
                  className="space-y-4 rounded-lg border border-steel/40 bg-surface p-5"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (!horseName) return;
                    await createHorse.mutateAsync({
                      name: horseName,
                      breed: horseBreed || 'Unknown',
                      color: '',
                      sex: 'Mare',
                      birthdate: '2018-01-01',
                      registrationNumber: '',
                    });
                    setCreatedHorse(true);
                  }}
                >
                  <p className="text-sm font-semibold text-ink">Manual entry</p>
                  <div className="space-y-1.5">
                    <Label htmlFor="ob-name">Horse name</Label>
                    <Input id="ob-name" value={horseName} onChange={(event) => setHorseName(event.target.value)} placeholder="Spirit" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ob-breed">Breed</Label>
                    <Input id="ob-breed" value={horseBreed} onChange={(event) => setHorseBreed(event.target.value)} placeholder="Arabian" />
                  </div>
                  <Button
                    type="submit"
                    variant="outline"
                    className="w-full"
                    disabled={!horseName || createHorse.isPending || createdHorse}
                    title={!horseName ? 'Enter a horse name first.' : undefined}
                  >
                    {createdHorse ? 'Horse created ✓' : createHorse.isPending ? 'Creating…' : 'Create horse'}
                  </Button>
                </form>
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-ink">Or upload registration for OCR</p>
                  <DropZone
                    onFiles={(files, errors) => {
                      if (files.length) setUploadNote(`${files.length} file${files.length === 1 ? '' : 's'} queued — OCR will run after setup.`);
                      else if (errors.length) setUploadNote(errors[0]!);
                    }}
                  />
                  {uploadNote && <p role="status" className="text-xs text-accent-strong">{uploadNote}</p>}
                </div>
              </div>
            </section>
          )}

          {step === 1 && (
            <section aria-labelledby="step-tour">
              <MicroLabel className="text-accent-strong">Step 2 · Quick tour</MicroLabel>
              <h1 id="step-tour" className="mt-2 text-2xl font-semibold text-ink">Three places you will live in</h1>
              <ul className="mt-6 space-y-3">
                {[
                  { icon: HorseheadIcon, title: 'Dashboard', body: 'Your daily mission brief: expiring documents, missing info, and recent activity at a glance.' },
                  { icon: FileScan, title: 'Documents', body: 'Drop any equine paperwork. OCR extracts the fields, scores its confidence, and you approve.' },
                  { icon: PartyPopper, title: 'Horse profiles', body: 'Timeline, health intervals, documents, ownership chain, and one-click sale packets per horse.' },
                ].map((item) => (
                  <li key={item.title} className="flex gap-4 rounded-lg border border-steel/40 bg-surface p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-blueline bg-accent-glow" aria-hidden>
                      <item.icon className="h-5 w-5 text-accent-strong" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-ink">{item.title}</p>
                      <p className="text-sm text-gunmetal">{item.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {step === 2 && (
            <section aria-labelledby="step-reminders">
              <MicroLabel className="text-accent-strong">Step 3 · Reminders</MicroLabel>
              <h1 id="step-reminders" className="mt-2 text-2xl font-semibold text-ink">Never miss a Coggins again</h1>
              <p className="mt-1 text-sm text-gunmetal">Choose what XBAR watches and how it reaches you.</p>
              <div className="mt-6 space-y-3 rounded-lg border border-steel/40 bg-surface p-5">
                {(
                  [
                    ['coggins', 'Coggins expiry', 'Alerts 30 and 7 days before the test lapses.'],
                    ['vaccines', 'Vaccination intervals', 'Spring and fall schedules per horse.'],
                    ['email', 'Email notifications', 'Daily digest to your inbox.'],
                    ['text', 'Text notifications', 'Urgent items only (expired compliance).'],
                  ] as const
                ).map(([key, title, body]) => (
                  <div key={key} className="flex items-center justify-between gap-4 border-b border-steel/30 pb-3 last:border-0 last:pb-0">
                    <div className="flex items-center gap-3">
                      <BellRing className="h-4 w-4 text-accent-strong" aria-hidden />
                      <div>
                        <p className="text-sm font-medium text-ink">{title}</p>
                        <p className="text-xs text-steel-muted">{body}</p>
                      </div>
                    </div>
                    <Switch
                      checked={prefs[key]}
                      onCheckedChange={(checked) => setPrefs({ ...prefs, [key]: checked })}
                      aria-label={title}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          {step === 3 && showTeamStep && (
            <section aria-labelledby="step-team">
              <MicroLabel className="text-accent-strong">Step 4 · Team (Business)</MicroLabel>
              <h1 id="step-team" className="mt-2 text-2xl font-semibold text-ink">Invite your team</h1>
              <p className="mt-1 text-sm text-gunmetal">Trainers, vets, and barn hands get role-scoped access. You can manage this later in Barn settings.</p>
              <form
                className="mt-6 space-y-4 rounded-lg border border-steel/40 bg-surface p-5"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!inviteEmail) return;
                  await inviteMember.mutateAsync({ email: inviteEmail, role: inviteRole });
                  setInvited([...invited, inviteEmail]);
                  setInviteEmail('');
                }}
              >
                <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
                  <div className="space-y-1.5">
                    <Label htmlFor="ob-invite-email">Email</Label>
                    <Input id="ob-invite-email" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="vet@clinic.com" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ob-invite-role">Role</Label>
                    <Select id="ob-invite-role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as typeof inviteRole)}>
                      <option value="trainer">Trainer</option>
                      <option value="vet">Vet</option>
                      <option value="barn-hand">Barn hand</option>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button type="submit" variant="outline" disabled={!inviteEmail || inviteMember.isPending}>
                      <UserPlus aria-hidden /> Invite
                    </Button>
                  </div>
                </div>
                {invited.length > 0 && (
                  <p role="status" className="text-xs text-accent-strong">Invited: {invited.join(', ')}</p>
                )}
              </form>
            </section>
          )}
        </motion.div>
      </main>

      <footer className="border-t border-steel/40 bg-surface px-4 py-4 sm:px-8">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <Button variant="ghost" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
            Back
          </Button>
          <Button onClick={next}>{step + 1 >= totalSteps ? 'Go to dashboard' : 'Continue'}</Button>
        </div>
      </footer>
    </div>
  );
}
