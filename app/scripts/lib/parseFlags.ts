/** Parses `--key=value` / `--flag` CLI args into a map. A bare `--flag` (no
 * `=value`) maps to `true`, letting callers detect its presence. */
export function parseFlags(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key) flags[key] = value ?? true;
  }
  return flags;
}
