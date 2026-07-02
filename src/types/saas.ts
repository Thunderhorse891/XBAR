export type ChipTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brass';

export type TaskPriority = 'Revenue Blocker' | 'High' | 'Medium' | 'Normal' | 'Planned';

export type WorkCategory = 'Setup' | 'Animal Care' | 'Ownership' | 'Pasture' | 'Feed' | 'Documents' | 'Sales' | 'Equipment';

export type WorkLinkedType = 'Workspace' | 'Animal' | 'Pasture' | 'Document' | 'Sale Packet' | 'Herd Group' | 'Equipment' | 'Ownership';

export type WorkTask = {
  id: string;
  title: string;
  linkedType: WorkLinkedType;
  linkedName: string;
  priority: TaskPriority;
  assignee: string;
  due: string;
  status: 'Open' | 'Review' | 'Blocking Release' | 'Planned';
  category: WorkCategory;
  detail: string;
  route: string;
  source: 'Workspace Setup' | 'Operations Priority' | 'Sale Hold';
  overdue?: boolean;
  blocker?: {
    horseId?: string;
    reasons: string[];
    nextAction: string;
    amount?: number;
  };
};
