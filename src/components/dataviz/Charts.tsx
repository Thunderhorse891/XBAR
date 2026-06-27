import { useEffect, useRef, useState } from 'react';
import './dataviz.css';

/*
 * XBAR dataviz — dependency-free, palette-aware SVG charts and animated
 * counters. Everything draws itself in on mount, respects reduced-motion,
 * and is accessibility-labelled. No chart library, no runtime cost beyond
 * a single rAF tween per counter.
 */

const PALETTE = {
  blue: '#4ea3ff',
  blueStrong: '#2d8cff',
  amber: '#e0a85a',
  rose: '#e5616a',
  emerald: '#4cc38a',
  grid: 'rgba(255,255,255,0.06)',
  axis: 'rgba(255,255,255,0.10)',
};

type Tone = keyof typeof PALETTE;

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function useInView<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, inView };
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function AnimatedCounter({
  value,
  format,
  durationMs = 900,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  durationMs?: number;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLSpanElement>();
  const [display, setDisplay] = useState(prefersReducedMotion() ? value : 0);

  useEffect(() => {
    if (!inView) return;
    if (prefersReducedMotion()) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      setDisplay(from + (value - from) * easeOutCubic(progress));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, durationMs]);

  const text = format ? format(display) : Math.round(display).toLocaleString();
  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {text}
    </span>
  );
}

// Smooth area sparkline with a gradient fill and a draw-in line.
export function Sparkline({
  data,
  tone = 'blue',
  width = 220,
  height = 56,
  label,
}: {
  data: number[];
  tone?: Tone;
  width?: number;
  height?: number;
  label?: string;
}) {
  const { ref, inView } = useInView<SVGSVGElement>();
  const points = data.length ? data : [0, 0];
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const span = max - min || 1;
  const stepX = width / Math.max(points.length - 1, 1);
  const pad = 4;
  const usableH = height - pad * 2;
  const coords = points.map((value, index) => {
    const x = index * stepX;
    const y = pad + usableH - ((value - min) / span) * usableH;
    return [x, y] as const;
  });

  // Catmull-Rom → cubic bezier for a smooth premium curve.
  const linePath = coords
    .map(([x, y], i) => {
      if (i === 0) return `M ${x} ${y}`;
      const [x0, y0] = coords[i - 1]!;
      const cx = (x0 + x) / 2;
      return `C ${cx} ${y0} ${cx} ${y} ${x} ${y}`;
    })
    .join(' ');
  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;
  const stroke = PALETTE[tone];
  const id = `spark-${tone}-${width}-${height}`;

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label={label ?? 'trend sparkline'}
      className="xbar-spark"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${id})`} opacity={inView ? 1 : 0} style={{ transition: 'opacity .6s ease .2s' }} />
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        style={{
          strokeDasharray: 1,
          strokeDashoffset: inView ? 0 : 1,
          transition: 'stroke-dashoffset 1s ease',
        }}
      />
    </svg>
  );
}

// Vertical bar chart with grow-in animation.
export function MiniBars({
  data,
  tone = 'blue',
  height = 120,
  label,
}: {
  data: { label: string; value: number; tone?: Tone }[];
  tone?: Tone;
  height?: number;
  label?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div ref={ref} className="xbar-bars" role="img" aria-label={label ?? 'bar chart'} style={{ height }}>
      {data.map((bar, index) => {
        const pct = (bar.value / max) * 100;
        return (
          <div key={bar.label} className="xbar-bars__col" title={`${bar.label}: ${bar.value}`}>
            <div className="xbar-bars__track">
              <div
                className="xbar-bars__fill"
                style={{
                  height: inView ? `${pct}%` : '0%',
                  background: `linear-gradient(180deg, ${PALETTE[bar.tone ?? tone]}, ${PALETTE[bar.tone ?? tone]}55)`,
                  transition: `height .8s cubic-bezier(.22,.61,.36,1) ${index * 60}ms`,
                }}
              />
            </div>
            <span className="xbar-bars__label">{bar.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// Radial progress gauge (donut) with animated arc + centre label.
export function RadialGauge({
  value,
  max = 100,
  tone = 'blue',
  size = 132,
  caption,
  centerLabel,
}: {
  value: number;
  max?: number;
  tone?: Tone;
  size?: number;
  caption?: string;
  centerLabel?: string;
}) {
  const { ref, inView } = useInView<SVGSVGElement>();
  const pct = Math.max(0, Math.min(1, value / (max || 1)));
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - (inView ? pct : 0));
  const color = PALETTE[tone];

  return (
    <div className="xbar-gauge">
      <svg ref={ref} width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={caption ?? 'progress gauge'}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 1.1s cubic-bezier(.22,.61,.36,1)' }}
        />
        <text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" className="xbar-gauge__value">
          {centerLabel ?? `${Math.round(pct * 100)}%`}
        </text>
      </svg>
      {caption ? <span className="xbar-gauge__caption">{caption}</span> : null}
    </div>
  );
}

// Horizontal segmented progress for compositional data (e.g. status mix).
export function StackBar({ segments, label }: { segments: { tone: Tone; value: number; label: string }[]; label?: string }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  return (
    <div ref={ref} className="xbar-stackbar" role="img" aria-label={label ?? 'composition'}>
      <div className="xbar-stackbar__track">
        {segments.map((seg, index) => (
          <div
            key={seg.label}
            className="xbar-stackbar__seg"
            title={`${seg.label}: ${seg.value}`}
            style={{
              width: inView ? `${(seg.value / total) * 100}%` : '0%',
              background: PALETTE[seg.tone],
              transition: `width .8s cubic-bezier(.22,.61,.36,1) ${index * 80}ms`,
            }}
          />
        ))}
      </div>
      <div className="xbar-stackbar__legend">
        {segments.filter((s) => s.value > 0).map((seg) => (
          <span key={seg.label}>
            <i style={{ background: PALETTE[seg.tone] }} />
            {seg.label} {seg.value}
          </span>
        ))}
      </div>
    </div>
  );
}
