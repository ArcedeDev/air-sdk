/**
 * Minimal CLI colors — zero dependencies.
 * Respects NO_COLOR env var and non-TTY streams.
 */

const enabled = process.stdout.isTTY && !process.env.NO_COLOR;

const code = (open: number, close: number) =>
  enabled
    ? (s: string) => `\x1b[${open}m${s}\x1b[${close}m`
    : (s: string) => s;

export const bold = code(1, 22);
export const dim = code(2, 22);
export const green = code(32, 39);
export const red = code(31, 39);
export const yellow = code(33, 39);
export const cyan = code(36, 39);
