import type { ReactNode } from "react";

/** Shared title+subtitle block for a top-level page (Discover/Explore/
    Rewards) — same heading size, subtitle style, and spacing everywhere, so
    switching between them via the navbar doesn't feel like landing on a
    differently-designed site each time. */
export function PageHeader({ title, description }: { title: string; description: ReactNode }) {
  return (
    <div>
      <h1 className="font-display text-balance text-heading-lg font-normal leading-[1.15] tracking-tight text-ink">
        {title}
      </h1>
      <p className="mt-2 max-w-2xl text-pretty text-body text-slate">{description}</p>
    </div>
  );
}
