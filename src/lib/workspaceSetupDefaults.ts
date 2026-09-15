/*
 * The workspace profile's DERIVED defaults -- the two that are computed from
 * what the customer actually typed, and nothing else.
 *
 * The setup screen has two ways out: `handleSubmit` (the form's own button) and
 * `handleQuickStart` (the skip-everything path in preview and local builds).
 * Only the second applied any fallbacks, so the primary path -- the one a
 * paying customer clicks -- wrote whatever was left blank straight through as
 * an empty string.
 *
 * That was not cosmetic. Six of the eight setup fields read as optional, and
 * the horse-create panel seeds its Legal owner and Owner entity from this
 * profile. A customer who filled only the two required fields reached Horses
 * with both blank, and Owner entity is required to create a horse -- so the
 * very first record in the product was refused, with no way back except typing
 * into a field nothing had said was needed. "Use ranch defaults" did not help,
 * because it copies from this profile, which is the thing that was empty.
 *
 * WHAT THIS DELIBERATELY DOES NOT FILL, and why the list is short:
 *
 * The first version of this shared the whole quick-start ladder, which also
 * invented a ranch manager, a barn, a pasture and -- worst -- an operations
 * email of `owner@ranch.local`. That address is not decoration: it is printed
 * into generated documents as "Operations email" and "Scheduling contact", it
 * is the recipient of the Reminders page's alert-digest mail link, and
 * `initializeWorkspace` writes it onto the workspace member record. Inventing
 * it meant the product published contact details for a mailbox that does not
 * exist, as though the customer had supplied them.
 *
 * The other three were unnecessary for a different reason: their consumers
 * already degrade honestly on a blank (`'Unassigned'` for the manager,
 * `'Main Barn'` and `'North Pasture'` as form PLACEHOLDERS), so filling them
 * here replaced an honest absence with stored data that only looked real.
 *
 * What is left is the two values the first-horse defect actually needed, and
 * both are derivations of something the customer typed rather than inventions:
 * the ranch is who owns the horse until someone says otherwise, and the
 * business is the entity that ranch trades as. Both are editable in Settings.
 *
 * Business and ranch name are passed through untouched. They are the two
 * fields `initializeWorkspace` requires, and inventing a business name for
 * someone who left it blank would defeat that check. Quick-start supplies its
 * own placeholders for those before calling this, which is why they arrive as
 * part of the input rather than being defaulted here.
 */
export type WorkspaceProfileDefaultsInput = {
  businessName: string;
  ranchName: string;
  ranchManagerName: string;
  operationsEmail: string;
  defaultOwnerName: string;
  defaultOwnerEntity: string;
  defaultBarn: string;
  defaultPasture: string;
};

export function applyWorkspaceProfileDefaults(form: WorkspaceProfileDefaultsInput): WorkspaceProfileDefaultsInput {
  const businessName = form.businessName.trim();
  const ranchName = form.ranchName.trim();
  return {
    businessName,
    ranchName,
    ranchManagerName: form.ranchManagerName.trim(),
    operationsEmail: form.operationsEmail.trim(),
    defaultOwnerName: form.defaultOwnerName.trim() || ranchName,
    defaultOwnerEntity: form.defaultOwnerEntity.trim() || businessName,
    defaultBarn: form.defaultBarn.trim(),
    defaultPasture: form.defaultPasture.trim(),
  };
}
