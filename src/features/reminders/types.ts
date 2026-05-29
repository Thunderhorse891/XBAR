export type ReminderKind = 'Care' | 'Ownership' | 'Documents' | 'Sales';
export type ReminderUrgency = 'Due' | 'Watch' | 'Clear';
export type ReminderFilter = ReminderKind | 'All';

export type ReminderItem = {
  id: string;
  kind: ReminderKind;
  urgency: ReminderUrgency;
  title: string;
  horseId?: string;
  horseName?: string;
  dueDate?: string;
  detail: string;
  route: string;
};
