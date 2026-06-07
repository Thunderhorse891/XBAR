import { buildBudgetSummary, buildCareBoardRows, buildTransferGapRows } from '@/lib/dashboardOps';
import { buildOperationalValuePulse } from '@/lib/operationalValuePulse';
import { useXbarStore } from '@/store/useXbarStore';
import { OperationalValuePulse } from './OperationalValuePulse';

export function OperationalValuePulseConnected() {
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const expenseReceipts = useXbarStore((state) => state.expenseReceipts);
  const salesLeads = useXbarStore((state) => state.salesLeads);

  if (!horses.length) {
    return null;
  }

  const reviewQueueCount = documents.filter((document) => document.state === 'Needs Review' || document.state === 'Matched').length;
  const transferGapCount = buildTransferGapRows(horses, ownershipRecords, documents).length;
  const careDueCount = buildCareBoardRows(horses, documents, expenseReceipts)
    .filter((row) => row.signals.some((signal) => signal.status === 'due')).length;
  const currentMonthReceiptCount = buildBudgetSummary(expenseReceipts).receiptCount;
  const linkedDocumentHorseCount = new Set(documents.flatMap((document) => document.horseId ? [document.horseId] : [])).size;
  const activeLeadCount = salesLeads.filter((lead) => lead.stage !== 'Closed').length;
  const pulse = buildOperationalValuePulse({
    horseCount: horses.length,
    linkedDocumentHorseCount,
    reviewQueueCount,
    transferGapCount,
    careDueCount,
    currentMonthReceiptCount,
    activeLeadCount,
  });

  return <OperationalValuePulse pulse={pulse} />;
}
