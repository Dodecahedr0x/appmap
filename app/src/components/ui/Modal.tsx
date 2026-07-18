"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

// Kept in sync with the `duration-200` exit transition below — the card
// stays mounted this long after `open` goes false so the fade/scale-out can
// actually play instead of the modal disappearing mid-animation.
const EXIT_MS = 200;

/**
 * A minimal, generic modal: fixed backdrop + centered card, closes on
 * Escape or backdrop click, and locks page scroll while open. No focus
 * trap — every control inside is reached in the same tab order as the
 * rest of the page, and Escape/backdrop-click are enough to dismiss it
 * without one for this app's current modal use (a single short form).
 *
 * Opening/closing materializes the card (fade + scale from the card's own
 * center) rather than popping in/out instantly, and mirrors the same path
 * in reverse on close. `visible` stays mounted through the exit transition;
 * `motion-safe:scale-*` means reduced-motion users still get the opacity
 * cross-fade but never the transform.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidthClassName = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Tailwind max-width class for the dialog card — widen it for content
      that needs more than the default single-column form width. */
  maxWidthClassName?: string;
}) {
  const [rendered, setRendered] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setRendered(true);
      // Mount closed first, then flip to visible on the next frame so the
      // enter transition actually has a "from" state to animate out of.
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const t = setTimeout(() => setRendered(false), EXIT_MS);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!rendered) return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4 transition-colors duration-200",
        visible ? "bg-mist/70" : "bg-mist/0",
      )}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "card my-8 w-full p-6 transition-opacity duration-200 motion-safe:transition-[opacity,transform]",
          maxWidthClassName,
          visible
            ? "opacity-100 motion-safe:scale-100"
            : "opacity-0 motion-safe:scale-95",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-heading-sm font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-11 w-11 place-items-center rounded-navitem text-slate transition-[color,background-color,transform] duration-150 hover:bg-ivory hover:text-ink active:scale-[0.96]"
          >
            ✕
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
