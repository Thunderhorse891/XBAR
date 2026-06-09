'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useCreateEvent, useHorses } from '@/hooks/queries';

const schema = z.object({
  title: z.string().min(2, 'Title is required.'),
  horseId: z.string(),
  kind: z.enum(['vet', 'farrier', 'lesson', 'show']),
  date: z.string().min(8, 'Date is required.'),
  time: z.string().min(4, 'Time is required.'),
  durationMinutes: z.coerce.number().min(15).max(720),
  recurring: z.enum(['none', 'weekly', 'monthly', 'yearly']),
  reminder: z.enum(['none', 'email', 'push', 'both']),
  notes: z.string().optional().default(''),
});

type FormValues = z.infer<typeof schema>;

export function EventModal({ open, onClose, defaultDate }: { open: boolean; onClose: () => void; defaultDate?: string }) {
  const { data: horses } = useHorses();
  const createEvent = useCreateEvent();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      horseId: '',
      kind: 'vet',
      date: defaultDate ?? new Date().toISOString().slice(0, 10),
      time: '09:00',
      durationMinutes: 60,
      recurring: 'none',
      reminder: 'email',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    const horse = horses?.find((entry) => entry.id === values.horseId);
    await createEvent.mutateAsync({
      title: values.title,
      horseId: values.horseId || null,
      horseName: horse?.name ?? null,
      kind: values.kind,
      start: new Date(`${values.date}T${values.time}:00`).toISOString(),
      durationMinutes: values.durationMinutes,
      recurring: values.recurring,
      reminder: values.reminder,
      notes: values.notes ?? '',
    });
    reset();
    onClose();
  });

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New event</DialogTitle>
          <DialogDescription>Scheduled events feed reminders and the compliance countdowns.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="event-title">Title</Label>
            <Input id="event-title" placeholder="Coggins draw — Spirit" {...register('title')} aria-invalid={Boolean(errors.title)} />
            {errors.title && <p role="alert" className="text-xs text-danger">{errors.title.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="event-horse">Horse</Label>
              <Select id="event-horse" {...register('horseId')}>
                <option value="">Whole barn</option>
                {(horses ?? []).map((horse) => (
                  <option key={horse.id} value={horse.id}>{horse.name}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="event-kind">Type</Label>
              <Select id="event-kind" {...register('kind')}>
                <option value="vet">Vet</option>
                <option value="farrier">Farrier</option>
                <option value="lesson">Lesson</option>
                <option value="show">Show</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="event-date">Date</Label>
              <Input id="event-date" type="date" {...register('date')} aria-invalid={Boolean(errors.date)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="event-time">Time</Label>
              <Input id="event-time" type="time" {...register('time')} aria-invalid={Boolean(errors.time)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="event-duration">Duration (min)</Label>
              <Input id="event-duration" type="number" min={15} step={15} {...register('durationMinutes')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="event-recurring">Repeats</Label>
              <Select id="event-recurring" {...register('recurring')}>
                <option value="none">Does not repeat</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="event-reminder">Reminder</Label>
            <Select id="event-reminder" {...register('reminder')}>
              <option value="none">No reminder</option>
              <option value="email">Email</option>
              <option value="push">Push</option>
              <option value="both">Email + push</option>
            </Select>
            <p className="text-xs text-steel-muted">Reminders send 7 days and 1 day before the event.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="event-notes">Notes</Label>
            <Textarea id="event-notes" placeholder="Haul-in details, vet instructions…" {...register('notes')} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createEvent.isPending}>{createEvent.isPending ? 'Saving…' : 'Create event'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
