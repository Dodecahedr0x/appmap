/**
 * A single soft, slowly breathing glow anchored near the toast's icon — a
 * quiet accent, not a distraction from the message. Purely decorative
 * (`aria-hidden`); `motion-safe:` drops the pulse for `prefers-reduced-
 * motion` users, leaving a static glow.
 */
export function ToastGlow({ color }: { color: readonly [number, number, number] }) {
  const rgb = color.map((c) => Math.round(c * 255)).join(", ");
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute left-0 top-1/2 h-28 w-28 -translate-x-1/3 -translate-y-1/2 rounded-full blur-2xl motion-safe:animate-toast-glow-pulse"
      style={{ background: `radial-gradient(circle, rgba(${rgb}, 0.5) 0%, rgba(${rgb}, 0) 70%)` }}
    />
  );
}
