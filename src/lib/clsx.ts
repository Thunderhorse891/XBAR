export function clsx(...args: (boolean | string)[]): string {
  return args
    .filter((x) => typeof x === 'string' || (typeof x === 'boolean' && x))
    .join(' ');
}
