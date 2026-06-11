'use client';

import { useMemo, useState } from 'react';
import { CalendarPlus, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { EventModal } from '@/components/calendar/event-modal';
import { Button } from '@/components/ui/button';
import { CommandCard } from '@/components/ui/card';
import { MicroLabel } from '@/components/shared/status';
import { useCalendarEvents } from '@/hooks/queries';
import { cn, formatDateTime } from '@/lib/utils';
import type { CalendarEvent } from '@/lib/types';

// Color coding — no green in the system: show events use a graphite chip.
const KIND_STYLES: Record<CalendarEvent['kind'], string> = {
  vet: 'bg-accent text-ink',
  farrier: 'bg-steel text-ink-graphite',
  lesson: 'bg-warning text-ink',
  show: 'bg-ink-graphite text-surface border border-metal',
};

const KIND_LABELS: Record<CalendarEvent['kind'], string> = {
  vet: 'Vet',
  farrier: 'Farrier',
  lesson: 'Lesson',
  show: 'Show',
};

type ViewMode = 'month' | 'week' | 'day';

export default function CalendarPage() {
  const { data: events } = useCalendarEvents();
  const [cursor, setCursor] = useState(() => new Date());
  const [view, setView] = useState<ViewMode>('month');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDate, setModalDate] = useState<string | undefined>(undefined);

  const monthLabel = cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events ?? []) {
      const key = event.start.slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return map;
  }, [events]);

  const upcoming = useMemo(() => {
    const limit = Date.now() + 7 * 86_400_000;
    return (events ?? [])
      .filter((event) => {
        const time = new Date(event.start).getTime();
        return time >= Date.now() - 3_600_000 && time <= limit;
      })
      .sort((a, b) => a.start.localeCompare(b.start));
  }, [events]);

  const shift = (delta: number) => {
    const next = new Date(cursor);
    if (view === 'month') next.setMonth(next.getMonth() + delta);
    else next.setDate(next.getDate() + delta * (view === 'week' ? 7 : 1));
    setCursor(next);
  };

  const exportIcs = () => {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//XBAR//Equine Operations//EN',
      ...(events ?? []).flatMap((event) => {
        const start = new Date(event.start);
        const end = new Date(start.getTime() + event.durationMinutes * 60_000);
        const stamp = (date: Date) => date.toISOString().replace(/[-:]|\.\d{3}/g, '');
        return [
          'BEGIN:VEVENT',
          `UID:${event.id}@xbar`,
          `DTSTART:${stamp(start)}`,
          `DTEND:${stamp(end)}`,
          `SUMMARY:${event.title}`,
          event.notes ? `DESCRIPTION:${event.notes}` : '',
          'END:VEVENT',
        ].filter(Boolean);
      }),
      'END:VCALENDAR',
    ];
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'xbar-calendar.ics';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  // Month grid cells (leading blanks + days).
  const monthCells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const cells: (Date | null)[] = Array.from({ length: first.getDay() }, () => null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), day));
    }
    return cells;
  }, [cursor]);

  const listDays = useMemo(() => {
    if (view === 'day') return [new Date(cursor)];
    const start = new Date(cursor);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [cursor, view]);

  const todayKey = new Date().toISOString().slice(0, 10);
  const dayKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  return (
    <>
      <Header title="Calendar" />
      <div className="grid gap-5 p-4 sm:p-6 xl:grid-cols-[1fr_280px]">
        <div className="min-w-0 space-y-4">
          {/* Dark command header */}
          <CommandCard className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="text-steel-strong hover:bg-panel-elevated hover:text-surface" onClick={() => shift(-1)} aria-label="Previous period">
                <ChevronLeft aria-hidden />
              </Button>
              <h2 className="min-w-44 text-center text-base font-semibold text-heading">{monthLabel}</h2>
              <Button variant="ghost" size="icon" className="text-steel-strong hover:bg-panel-elevated hover:text-surface" onClick={() => shift(1)} aria-label="Next period">
                <ChevronRight aria-hidden />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-md border border-metal" role="group" aria-label="Calendar view">
                {(['month', 'week', 'day'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setView(mode)}
                    aria-pressed={view === mode}
                    className={cn(
                      'px-3 py-1.5 text-xs font-semibold uppercase tracking-micro first:rounded-l-md last:rounded-r-md',
                      view === mode ? 'bg-accent text-ink' : 'text-steel-muted hover:text-surface',
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <Button variant="command" size="sm" onClick={exportIcs}>
                <Download aria-hidden /> Export .ics
              </Button>
              <Button size="sm" onClick={() => { setModalDate(undefined); setModalOpen(true); }}>
                <CalendarPlus aria-hidden /> New event
              </Button>
            </div>
          </CommandCard>

          {view === 'month' ? (
            <div className="rounded-lg border border-steel/40 bg-surface p-3 shadow-lift">
              <div className="grid grid-cols-7 gap-px" role="grid" aria-label={`Calendar for ${monthLabel}`}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                  <div key={day} className="px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-micro text-steel-muted" role="columnheader">
                    {day}
                  </div>
                ))}
                {monthCells.map((date, index) => {
                  if (!date) return <div key={`blank-${index}`} role="gridcell" aria-hidden className="min-h-20" />;
                  const key = dayKey(date);
                  const dayEvents = eventsByDay.get(key) ?? [];
                  const isToday = key === todayKey;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="gridcell"
                      aria-label={`${date.toDateString()}, ${dayEvents.length} events`}
                      onClick={() => { setModalDate(key); setModalOpen(true); }}
                      className={cn(
                        'min-h-20 rounded-md border border-transparent p-1.5 text-left align-top transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                        isToday && 'border-blueline bg-accent-glow',
                      )}
                    >
                      <span className={cn('text-xs font-semibold', isToday ? 'text-accent-strong' : 'text-gunmetal')}>{date.getDate()}</span>
                      <span className="mt-1 block space-y-0.5">
                        {dayEvents.slice(0, 2).map((event) => (
                          <span key={event.id} className={cn('block truncate rounded px-1 py-0.5 text-[10px] font-semibold', KIND_STYLES[event.kind])}>
                            {event.title}
                          </span>
                        ))}
                        {dayEvents.length > 2 && <span className="block text-[10px] text-steel-muted">+{dayEvents.length - 2} more</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {listDays.map((date) => {
                const key = dayKey(date);
                const dayEvents = (eventsByDay.get(key) ?? []).sort((a, b) => a.start.localeCompare(b.start));
                return (
                  <div key={key} className="rounded-lg border border-steel/40 bg-surface p-4 shadow-lift">
                    <div className="flex items-center justify-between">
                      <p className={cn('text-sm font-semibold', key === todayKey ? 'text-accent-strong' : 'text-ink')}>
                        {date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                      </p>
                      <Button variant="ghost" size="sm" onClick={() => { setModalDate(key); setModalOpen(true); }}>Add</Button>
                    </div>
                    {dayEvents.length === 0 ? (
                      <p className="mt-1 text-xs text-steel-muted">No events scheduled.</p>
                    ) : (
                      <ul className="mt-2 space-y-1.5">
                        {dayEvents.map((event) => (
                          <li key={event.id} className="flex items-center gap-2 text-sm">
                            <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-micro', KIND_STYLES[event.kind])}>
                              {KIND_LABELS[event.kind]}
                            </span>
                            <span className="font-medium text-ink">{event.title}</span>
                            <span className="text-xs text-steel-muted">{formatDateTime(event.start)} · {event.durationMinutes} min</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap gap-3" aria-hidden>
            {Object.entries(KIND_LABELS).map(([kind, label]) => (
              <span key={kind} className="flex items-center gap-1.5 text-xs text-gunmetal">
                <span className={cn('h-2.5 w-2.5 rounded-sm', KIND_STYLES[kind as CalendarEvent['kind']])} /> {label}
              </span>
            ))}
          </div>
        </div>

        {/* Upcoming sidebar */}
        <aside className="space-y-3" aria-label="Upcoming events">
          <MicroLabel>Next 7 days</MicroLabel>
          {upcoming.length === 0 && <p className="text-sm text-gunmetal">Nothing scheduled this week.</p>}
          <ul className="space-y-2">
            {upcoming.map((event) => (
              <li key={event.id} className="rounded-lg border border-steel/40 bg-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-ink">{event.title}</p>
                  <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-micro', KIND_STYLES[event.kind])}>
                    {KIND_LABELS[event.kind]}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-steel-muted">
                  {formatDateTime(event.start)}{event.horseName ? ` · ${event.horseName}` : ' · whole barn'}
                </p>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <EventModal open={modalOpen} onClose={() => setModalOpen(false)} defaultDate={modalDate} />
    </>
  );
}
