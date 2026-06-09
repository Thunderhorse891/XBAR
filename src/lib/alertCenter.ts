import type { OperationsPriorityItem } from './operationsPriority.js';

type AlertKind = OperationsPriorityItem['kind'];

export type AutomatedAlert = {
  id: string;
  kind: AlertKind;
  title: string;
  detail: string;
  horseName?: string;
  dueDate?: string;
  timing: OperationsPriorityItem['timing'];
  route: string;
  severity: 'critical' | 'warning';
};

export type AlertDigest = {
  alerts: AutomatedAlert[];
  overdueCount: number;
  dueSoonCount: number;
  emailSubject: string;
  emailBody: string;
  browserTitle: string;
  browserBody: string;
};

function severityFor(item: OperationsPriorityItem): AutomatedAlert['severity'] {
  return item.urgency === 'Due' || item.timing === 'Overdue' || item.timing === 'Today' ? 'critical' : 'warning';
}

function isAlertWorthy(item: OperationsPriorityItem) {
  return item.urgency !== 'Clear' && item.timing !== 'Later' && item.timing !== 'Unscheduled';
}

function formatLine(alert: AutomatedAlert) {
  const subject = alert.horseName ? `${alert.horseName}: ${alert.title}` : alert.title;
  const date = alert.dueDate ? ` | due ${alert.dueDate}` : '';
  return `- [${alert.timing}] ${subject}${date} | ${alert.detail}`;
}

export function buildAlertDigest(items: OperationsPriorityItem[], now = new Date()): AlertDigest {
  const alerts = items
    .filter(isAlertWorthy)
    .slice(0, 12)
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      detail: item.detail,
      horseName: item.horseName,
      dueDate: item.dueDate,
      timing: item.timing,
      route: item.route,
      severity: severityFor(item),
    })) satisfies AutomatedAlert[];

  const overdueCount = alerts.filter((alert) => alert.timing === 'Overdue').length;
  const dueSoonCount = alerts.filter((alert) => alert.timing === 'Today' || alert.timing === 'This week').length;
  const dateStamp = now.toISOString().slice(0, 10);
  const emailSubject = alerts.length ? `XBAR alerts: ${overdueCount} overdue, ${dueSoonCount} due soon` : 'XBAR alerts: no open expiration alerts';
  const emailBody = alerts.length
    ? [`XBAR automated alert digest — ${dateStamp}`, '', ...alerts.map(formatLine), '', 'Open XBAR to clear these items from the Reminders queue.'].join('\n')
    : `XBAR automated alert digest — ${dateStamp}\n\nNo overdue or due-soon care, ownership, document, or sales alerts are currently open.`;

  return {
    alerts,
    overdueCount,
    dueSoonCount,
    emailSubject,
    emailBody,
    browserTitle: alerts.length ? 'XBAR alerts need attention' : 'XBAR alerts clear',
    browserBody: alerts.length ? `${overdueCount} overdue · ${dueSoonCount} due today/this week` : 'No urgent horse-care alerts are open.',
  };
}

export function buildAlertMailto(digest: AlertDigest, to = '') {
  const address = encodeURIComponent(to);
  const subject = encodeURIComponent(digest.emailSubject);
  const body = encodeURIComponent(digest.emailBody);
  return `mailto:${address}?subject=${subject}&body=${body}`;
}
