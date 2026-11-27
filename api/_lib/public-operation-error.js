// Only throw this type with application-authored recovery instructions.
// Provider/database errors and user-supplied text must never use this type.
export class PublicOperationError extends Error {}
