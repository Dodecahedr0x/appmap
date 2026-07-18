"use client";

import { useEffect, useState } from "react";

/**
 * Keeps `open`'s last truthy value mounted for `exitMs` after it goes
 * falsy, so an exit transition has time to play instead of the element
 * disappearing instantly. `visible` flips true a frame after mount (so
 * there's an actual "from" state for the enter transition to animate out
 * of) and false immediately on close.
 */
export function useMountTransition<T>(
  open: T,
  exitMs: number,
): { rendered: T; visible: boolean } {
  const [rendered, setRendered] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setRendered(open);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const t = setTimeout(() => setRendered(open), exitMs);
    return () => clearTimeout(t);
  }, [open, exitMs]);

  return { rendered, visible };
}
