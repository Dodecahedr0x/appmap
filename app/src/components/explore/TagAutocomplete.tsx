"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface TagOption {
  id: string;
  name: string;
}

// A dropdown longer than this stops being scannable at a glance — the
// whole point of replacing the old flat "every tag as a chip" list.
const MAX_SUGGESTIONS = 8;

/**
 * Type-ahead tag picker: type to filter a dropdown of closest-matching
 * tags (prefix matches first, then any substring match), click one (or
 * arrow keys + Enter) to select it. The input clears itself after a
 * selection — this is a picker, not a persistent search box, so there's
 * nothing left to show once the pick is made.
 */
export function TagAutocomplete({
  options,
  excludeIds = [],
  onSelect,
  placeholder = "Search tags…",
  ariaLabel = "Search tags",
}: {
  options: TagOption[];
  /** Tags already selected elsewhere — excluded from suggestions so the same tag can't be picked twice. */
  excludeIds?: string[];
  onSelect: (id: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const excluded = new Set(excludeIds);
  const q = query.trim().toLowerCase();
  const matches = q
    ? options
        .filter((t) => !excluded.has(t.id) && t.name.toLowerCase().includes(q))
        .sort((a, b) => {
          const aName = a.name.toLowerCase();
          const bName = b.name.toLowerCase();
          const aStarts = aName.startsWith(q) ? 0 : 1;
          const bStarts = bName.startsWith(q) ? 0 : 1;
          return aStarts - bStarts || aName.localeCompare(bName);
        })
        .slice(0, MAX_SUGGESTIONS)
    : [];

  // Closing on outside click (not just blur) so a click straight from the
  // input to a dropdown option doesn't flicker-close in between — the
  // option button's onMouseDown already preventDefaults its own blur (see
  // below), this handles every OTHER way focus can leave the picker.
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  // Query text can outlive the matches it was computed from (e.g. typing
  // fast, or the exclude list changing) — reclamp so a stale index never
  // points past the end of a freshly-shorter list.
  useEffect(() => {
    if (highlighted > matches.length - 1) setHighlighted(Math.max(0, matches.length - 1));
  }, [matches.length, highlighted]);

  function selectMatch(t: TagOption) {
    onSelect(t.id);
    setQuery("");
    setOpen(false);
    setHighlighted(0);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectMatch(matches[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        className="input"
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlighted(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-autocomplete="list"
        aria-controls={listboxId}
      />
      {open && matches.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-card border border-hairline bg-ivory py-1 shadow-hover"
        >
          {matches.map((t, i) => (
            <li key={t.id} role="option" aria-selected={i === highlighted}>
              <button
                type="button"
                className={cn(
                  "block w-full px-3 py-1.5 text-left text-sm transition-colors duration-100",
                  i === highlighted ? "bg-cobalt/15 text-cobalt" : "text-ink hover:bg-mist",
                )}
                // Fires before the input's own blur, so the dropdown doesn't
                // close (via the outside-click handler / a blur) before this
                // click is registered.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectMatch(t)}
                onMouseEnter={() => setHighlighted(i)}
              >
                #{t.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
