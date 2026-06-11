'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { MicroLabel } from '@/components/shared/status';
import { isOnboarded, signIn } from '@/lib/auth';
import type { Tier } from '@/lib/types';

const schema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  tier: z.enum(['basic', 'pro', 'business']),
});

type FormValues = z.infer<typeof schema>;

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', tier: 'pro' },
  });

  const onSubmit = (values: FormValues) => {
    signIn(values.email, values.tier as Tier);
    const next = params.get('next');
    router.push(isOnboarded() ? (next ?? '/dashboard') : '/onboarding');
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" placeholder="you@barn.com" {...register('email')} aria-invalid={Boolean(errors.email)} />
        {errors.email && <p role="alert" className="text-xs text-danger">{errors.email.message}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" autoComplete="current-password" placeholder="••••••••" {...register('password')} aria-invalid={Boolean(errors.password)} />
        {errors.password && <p role="alert" className="text-xs text-danger">{errors.password.message}</p>}
        <p className="text-xs text-steel-muted">Demo environment — any email and 8+ character password signs in.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tier">Sign in as plan (demo)</Label>
        <Select id="tier" {...register('tier')}>
          <option value="basic">Basic — hobby owner</option>
          <option value="pro">Pro — breeder / trainer</option>
          <option value="business">Business — commercial barn</option>
        </Select>
        <p className="text-xs text-steel-muted">Controls tier-gated features like barn settings and packet requests.</p>
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        Sign in to XBAR
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-shell p-10 lg:flex">
        <p className="text-lg font-bold tracking-tight text-heading">
          XBAR<span className="text-accent">.</span>
        </p>
        <div className="max-w-sm space-y-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-blueline bg-accent-glow" aria-hidden>
            <ShieldCheck className="h-6 w-6 text-accent" />
          </div>
          <h1 className="text-3xl font-semibold leading-tight text-heading">Operational command for every horse you manage.</h1>
          <p className="text-sm leading-relaxed text-steel-muted">
            Verified records, OCR document intake, compliance countdowns, and buyer-ready sale packets — in one secure workspace.
          </p>
        </div>
        <MicroLabel>Secure session · JWT · Audit logged</MicroLabel>
      </section>
      <section className="flex items-center justify-center bg-canvas p-6">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-semibold text-ink">Sign in</h2>
          <p className="mb-6 mt-1 text-sm text-gunmetal">Welcome back. Your barn is where you left it.</p>
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
