import { z } from 'zod';

/*
 * Shared request-body validation for the API. Endpoints parse their body
 * through a zod schema instead of hand-rolled typeof checks so required
 * fields, enums, and length caps are declared in one place and cannot be
 * silently missed.
 */

export const INVITE_ROLES = ['Admin', 'Ranch Manager', 'Owner', 'Medical Lead', 'Sales Lead'];
export const SUBSCRIPTION_TIERS = ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'];

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid email address is required.'),
  role: z.enum(INVITE_ROLES).catch('Sales Lead'),
  workspaceId: z.string().trim().min(1, 'Workspace id is required.'),
  invitationId: z.string().trim().optional().default(''),
});

export const checkoutSchema = z.object({
  tier: z.enum(SUBSCRIPTION_TIERS),
  workspaceId: z.string().trim().min(1, 'Workspace id is required.'),
  returnUrl: z.string().trim().optional().default(''),
  // seatCount is clamped in the handler (1..100) to preserve over-max clamping.
  seatCount: z.unknown().optional(),
});

export const telemetrySchema = z.object({
  workspaceId: z.string().trim().optional().default(''),
  eventName: z.string().trim().max(120).optional().default('runtime.event'),
  severity: z.enum(['info', 'warning', 'error']).catch('info'),
  payload: z.record(z.string(), z.unknown()).optional().default({}),
});

/**
 * Parse a request body against a schema.
 * Returns { ok: true, data } or { ok: false, message } with the first issue.
 */
export function parseBody(schema, body) {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const message = result.error.issues[0]?.message || 'Request body is invalid.';
    return { ok: false, message };
  }
  return { ok: true, data: result.data };
}
