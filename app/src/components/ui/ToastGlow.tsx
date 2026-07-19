/**
 * A single soft glow anchored near the toast's icon — a quiet, static
 * accent, not a distraction from the message. Purely decorative
 * (`aria-hidden`).
 */
export function ToastGlow({ color }: { color: readonly [number, number, number] }) {
  const rgb = color.map((c) => Math.round(c * 255)).join(", ");
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute left-0 top-1/2 h-24 w-24 -translate-x-1/3 -translate-y-1/2 rounded-full blur-2xl"
      style={{ background: `radial-gradient(circle, rgba(${rgb}, 0.35) 0%, rgba(${rgb}, 0) 70%)` }}
    />
  );
}
