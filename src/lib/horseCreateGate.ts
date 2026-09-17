/*
 * One rule for whether a horse form is ready, read by both the submit button
 * and the submit handler.
 *
 * They used to be two rules that agreed only by accident. The button was
 * disabled on `!name.trim() || !barnName.trim() || !owner.trim()`; the handler
 * refused on `name.length < 3`, `owner.length < 2` and -- the field the button
 * never looked at -- an empty `ownerEntity`. So the button could present itself
 * as ready for a form the handler was about to refuse, and did exactly that for
 * every customer whose workspace profile carried no default owner entity.
 *
 * An enabled control that refuses is worse than a disabled one: the disabled
 * control is honest about not being ready yet. Having one function answer both
 * questions is what keeps them from drifting apart again.
 */
export type HorseCreateFormFields = {
  name: string;
  barnName: string;
  owner: string;
  ownerEntity: string;
};

export type HorseCreateFieldErrors = Partial<Record<keyof HorseCreateFormFields, string>>;

export function horseCreateFieldErrors(form: HorseCreateFormFields): HorseCreateFieldErrors {
  const errors: HorseCreateFieldErrors = {};
  if (form.name.trim().length < 3) errors.name = 'Registered name is required.';
  if (!form.barnName.trim()) errors.barnName = 'Barn name is required.';
  if (form.owner.trim().length < 2) errors.owner = 'Legal owner is required.';
  if (form.ownerEntity.trim().length < 2) errors.ownerEntity = 'Owner entity is required.';
  return errors;
}

export function canSubmitHorseCreate(form: HorseCreateFormFields): boolean {
  return Object.keys(horseCreateFieldErrors(form)).length === 0;
}
