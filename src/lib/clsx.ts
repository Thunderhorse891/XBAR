export function clsx(...args: (string | boolean | undefined | null)[]): string {
  return args.filter((x): x is string => typeof x === 'string' && x.length > 0).join(' ');
}
