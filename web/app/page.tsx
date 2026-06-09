'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, FileScan, PackageCheck, PlayCircle, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MicroLabel } from '@/components/shared/status';
import { PricingTable } from '@/components/billing/pricing-table';

const FEATURES = [
  {
    icon: FileScan,
    title: 'OCR auto-profiling',
    body: 'Drop registration papers, Coggins tests, and health certificates. XBAR reads them, builds verified horse profiles, and flags anything below 90% confidence for review.',
  },
  {
    icon: PackageCheck,
    title: 'Sale packet in one click',
    body: 'Bundle every verified document with a pre-filled Bill of Sale into a single watermarked PDF. Buyer attribution is stamped on every page.',
  },
  {
    icon: Users,
    title: 'Multi-user barn tools',
    body: 'Role-scoped access for trainers, vets, and barn hands. Owners see their own horses only, and every action lands in the audit log.',
  },
];

const TESTIMONIALS = [
  { quote: 'I uploaded a season of paperwork and XBAR built every profile for me. The Coggins countdowns alone are worth it.', name: 'Erin W.', role: 'Owner, 5 horses' },
  { quote: 'Sale packets used to take an afternoon of scanning and emailing. Now it is one button and the buyer gets a watermarked PDF.', name: 'A. Quinn', role: 'Trainer & breeder' },
  { quote: 'Our barn runs 40 horses across three clients. Roles and the activity log finally gave us accountability.', name: 'M. Caldwell', role: 'Commercial barn manager' },
];

export default function LandingPage() {
  const router = useRouter();
  const [videoOpen, setVideoOpen] = useState(false);
  const [testimonial, setTestimonial] = useState(0);

  return (
    <div className="min-h-screen bg-canvas">
      <a href="#landing-main" className="skip-link">Skip to content</a>

      {/* Light header */}
      <header className="sticky top-0 z-30 border-b border-steel/40 bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <p className="text-lg font-bold tracking-tight text-ink">XBAR<span className="text-accent-strong">.</span></p>
          <nav aria-label="Landing" className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <a href="#pricing">Pricing</a>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild>
              <Link href="/login">Start 30-day free trial</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main id="landing-main">
        {/* Hero: light, with dark graphite command mockup */}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
          <div>
            <MicroLabel className="text-accent-strong">Equine operations platform</MicroLabel>
            <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight text-ink sm:text-5xl">
              Horse management that actually saves you time
            </h1>
            <p className="mt-4 max-w-lg text-lg text-gunmetal">
              OCR document intake, verified health records, compliance countdowns, and buyer-ready sale packets — for hobby owners, breeders, and commercial barns.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button size="lg" onClick={() => router.push('/login')}>Start 30-day free trial</Button>
              <Button variant="outline" size="lg" onClick={() => setVideoOpen(true)}>
                <PlayCircle aria-hidden /> Watch the demo
              </Button>
            </div>
            <p className="mt-3 text-xs text-steel-muted">No credit card required · cancel anytime</p>
          </div>

          {/* Dark command preview card */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            aria-label="Product preview: horse profile with alerts and packet readiness"
            className="rounded-xl border border-metal bg-panel-strong p-5 shadow-command"
          >
            <div className="flex items-center justify-between">
              <MicroLabel className="text-steel-strong">Horse record · live</MicroLabel>
              <Badge variant="blocked">Coggins expires in 4d</Badge>
            </div>
            <div className="mt-4 flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-metal bg-ink-graphite text-lg font-bold text-surface" aria-hidden>SD</div>
              <div>
                <p className="text-lg font-semibold text-heading">Spirit of the Desert</p>
                <p className="text-xs text-steel-muted">Arabian · Mare · 7 yrs · AHA 0654321</p>
              </div>
            </div>
            <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-metal pt-4">
              {[
                ['Documents', '6 verified'],
                ['Health', '1 due soon'],
                ['Ownership', 'Chain verified'],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[10px] uppercase tracking-micro text-steel-muted">{label}</dt>
                  <dd className="mt-0.5 text-sm font-semibold text-heading">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-5 flex items-center justify-between rounded-md border border-blueline bg-accent-glow p-3">
              <div>
                <p className="text-sm font-semibold text-heading">Sale packet readiness</p>
                <p className="text-xs text-steel-muted">4 documents + Bill of Sale · watermark ready</p>
              </div>
              <span className="rounded-md bg-accent px-3 py-1.5 text-xs font-bold text-ink">Generate</span>
            </div>
          </motion.div>
        </section>

        {/* Feature cards: light with metal borders */}
        <section className="border-y border-steel/40 bg-surface">
          <div className="mx-auto grid max-w-6xl gap-5 px-4 py-14 sm:px-6 md:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="rounded-lg border border-steel/40 bg-canvas p-6">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-blueline bg-accent-glow" aria-hidden>
                  <feature.icon className="h-5 w-5 text-accent-strong" />
                </div>
                <h2 className="mt-4 text-lg font-semibold text-ink">{feature.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-gunmetal">{feature.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="mb-8 text-left sm:text-center">
            <MicroLabel className="text-accent-strong">Pricing</MicroLabel>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink">A plan for every barn</h2>
            <p className="mt-2 text-gunmetal">Every plan starts with a 30-day free trial of Pro features.</p>
          </div>
          <PricingTable onSelect={() => router.push('/login')} />
        </section>
      </main>

      {/* Dark graphite footer */}
      <footer className="bg-shell text-surface">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="grid gap-10 md:grid-cols-[1fr_360px]">
            <div>
              <p className="text-lg font-bold text-heading">XBAR<span className="text-accent">.</span></p>
              <p className="mt-2 max-w-sm text-sm text-steel-muted">
                Operational discipline for equine records. Built for verification, evidence, and readiness.
              </p>
              <Button variant="command" className="mt-5" onClick={() => setVideoOpen(true)}>
                <PlayCircle aria-hidden /> Watch the 2-minute demo
              </Button>
              <p className="mt-6 text-xs text-steel-muted">Contact: hello@xbar.app · © {new Date().getFullYear()} XBAR</p>
            </div>

            {/* Testimonials carousel */}
            <div aria-label="Customer testimonials" className="rounded-lg border border-metal bg-panel p-5">
              <blockquote className="min-h-28 text-sm leading-relaxed text-steel-strong">
                “{TESTIMONIALS[testimonial]!.quote}”
              </blockquote>
              <p className="mt-3 text-sm font-semibold text-heading">{TESTIMONIALS[testimonial]!.name}</p>
              <p className="text-xs text-steel-muted">{TESTIMONIALS[testimonial]!.role}</p>
              <div className="mt-4 flex items-center justify-between">
                <div className="flex gap-1.5" aria-hidden>
                  {TESTIMONIALS.map((_, index) => (
                    <span key={index} className={`h-1.5 w-4 rounded-full ${index === testimonial ? 'bg-accent' : 'bg-gunmetal'}`} />
                  ))}
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    aria-label="Previous testimonial"
                    onClick={() => setTestimonial((testimonial + TESTIMONIALS.length - 1) % TESTIMONIALS.length)}
                    className="rounded p-1.5 text-steel-muted hover:text-surface"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label="Next testimonial"
                    onClick={() => setTestimonial((testimonial + 1) % TESTIMONIALS.length)}
                    className="rounded p-1.5 text-steel-muted hover:text-surface"
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </footer>

      {/* Demo video modal */}
      <Dialog open={videoOpen} onOpenChange={setVideoOpen}>
        <DialogContent tone="command" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-heading">XBAR in two minutes</DialogTitle>
          </DialogHeader>
          <div className="flex aspect-video items-center justify-center rounded-md border border-metal bg-panel-elevated">
            <div className="text-center">
              <PlayCircle className="mx-auto h-12 w-12 text-accent" aria-hidden />
              <p className="mt-2 text-sm text-steel-muted">Demo video embeds here (Mux / YouTube).</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
