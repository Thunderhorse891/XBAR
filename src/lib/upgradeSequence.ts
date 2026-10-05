type PendingDecline = { save: () => Promise<boolean>; pending: Promise<boolean> };
const declines = new Map<string, PendingDecline>();

/** Ordering only, never offer eligibility. The server still owns all counts and pricing. */
export function queueUpgradeDecline(scope: string, save: () => Promise<boolean>) {
  const previous = declines.get(scope);
  const saveInOrder = async () => {
    if (previous && !(await settle(previous))) return false;
    return save();
  };
  const item: PendingDecline = { save: saveInOrder, pending: saveInOrder().catch(() => false) };
  declines.set(scope, item);
  void item.pending.then((saved) => {
    if (saved && declines.get(scope) === item) declines.delete(scope);
  });
}

export async function waitForUpgradeDecline(scope: string): Promise<boolean> {
  const item = declines.get(scope);
  if (!item) return true;
  const saved = await settle(item);
  if (saved && declines.get(scope) === item) declines.delete(scope);
  return saved;
}

async function settle(item: PendingDecline): Promise<boolean> {
  if (await item.pending) return true;
  // Same decline id, retried before creating a distinct attempt. A lost write
  // must not permanently consume the customer's actual second attempt.
  item.pending = item.save().catch(() => false);
  return item.pending;
}
