/*
 * One ladder for the workspace profile's derived defaults.
 *
 * The setup screen has two ways out: `handleSubmit` (the form's own button) and
 * `handleQuickStart` (the skip-everything path in preview and local builds).
 * Only the second applied a fallback ladder, so the primary path -- the one a
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
 * Business and ranch name are deliberately NOT defaulted here. They are the two
 * fields `initializeWorkspace` requires, and inventing a business name for
 * someone who left it blank would defeat that check. Quick-start supplies its
 * own placeholders for those two before calling this, which is why they arrive
 * as arguments rather than being read off the form.
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
    ranchManagerName: form.ranchManagerName.trim() || 'Operations Lead',
    operationsEmail: form.operationsEmail.trim() || 'owner@ranch.local',
    // The ranch is who owns the horse until someone says otherwise, and the
    // business is the entity that ranch trades as. Both are better guesses than
    // a blank, and both are editable in Settings.
    defaultOwnerName: form.defaultOwnerName.trim() || ranchName,
    defaultOwnerEntity: form.defaultOwnerEntity.trim() || businessName,
    defaultBarn: form.defaultBarn.trim() || 'Barn 1',
    defaultPasture: form.defaultPasture.trim() || 'Pasture 1',
  };
}
