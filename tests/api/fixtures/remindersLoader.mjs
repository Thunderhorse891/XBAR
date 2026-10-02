export async function resolve(specifier, context, nextResolve) {
  if (specifier === './supabase-admin.js' && context.parentURL.endsWith('/reminders-run.js')) {
    return { url: new URL('./remindersBoundary.mjs', import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
