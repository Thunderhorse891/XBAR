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

export const BUYER_INQUIRY_KINDS = ['question', 'call-requested', 'proof-requested', 'offer', 'packet-downloaded'];
const MAX_BUYER_MESSAGE_CHARS = 1200;

// Shapes and caps only — the kind-specific requirements (an offer needs an
// amount, a question needs a message) stay in the handler where the
// buyer-facing error copy lives.
export const buyerInquirySchema = z.object({
  sharePath: z.string().trim().optional().default(''),
  shareToken: z.string().trim().optional().default(''),
  kind: z.string().optional().default(''),
  buyerName: z
    .string()
    .trim()
    .transform((value) => value.slice(0, 120))
    .optional()
    .default(''),
  buyerEmail: z
    .string()
    .trim()
    .toLowerCase()
    .transform((value) => value.slice(0, 200))
    .optional()
    .default(''),
  message: z
    .string()
    .trim()
    .transform((value) => value.slice(0, MAX_BUYER_MESSAGE_CHARS))
    .optional()
    .default(''),
  amount: z.unknown().optional(),
});

export const buyerResponseSchema = z.object({
  workspaceId: z.string().trim().min(1),
  replyToEventId: z.string().trim().min(1),
  note: z
    .string()
    .trim()
    .min(1)
    .transform((value) => value.slice(0, MAX_BUYER_MESSAGE_CHARS)),
});

// CSV imports are bounded so a single request cannot buffer unbounded input
// through the service-role client.
export const MAX_IMPORT_CSV_CHARS = 2_000_000;

export const horsesImportSchema = z.object({
  workspaceId: z.string().trim().min(1),
  csv: z.string().min(1).max(MAX_IMPORT_CSV_CHARS, 'CSV imports are limited to 2 MB per request.'),
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
