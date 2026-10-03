// Whitelist, rather than trying to enumerate every possible secret/PII field.
export function sanitizeEvent(event) {
  return {
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: event.platform,
    level: event.level,
    environment: event.environment,
    release: event.release,
    message: 'XBAR application failure (details omitted)',
    exception: event.exception
      ? {
          values: event.exception.values?.map((value) => ({
            type: ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError'].includes(value.type)
              ? value.type
              : 'Error',
            value: 'Application error (details omitted)',
            stacktrace: {
              frames: value.stacktrace?.frames
                ?.filter((frame) => frame.in_app)
                .map((frame) => ({
                  filename:
                    typeof frame.filename === 'string' ? frame.filename.split(/[?#]/)[0].split('/').pop() : undefined,
                  lineno: frame.lineno,
                  colno: frame.colno,
                  in_app: true,
                })),
            },
          })),
        }
      : undefined,
  };
}
