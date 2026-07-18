"use client";

import { useAdServe } from "@/hooks/useAdServe";

/**
 * An ad slot rendered on an app page. On mount it requests an ad from the
 * server (which records a revenue-bearing impression tied to this visit) and
 * reports clicks. Revenue from these impressions is shared with the app's
 * stakers when the epoch settles.
 */
export function AdSlot({ appId }: { appId: string }) {
  const { ad, onClick } = useAdServe(appId);

  if (!ad) {
    return (
      <div className="card grid h-32 place-items-center p-6 text-xs text-slate-steel">
        Sponsored
      </div>
    );
  }

  return (
    <a
      href={ad.targetUrl}
      target="_blank"
      rel="noopener noreferrer sponsored"
      onClick={onClick}
      className="card group animate-fade-in block overflow-hidden p-0 transition-colors hover:border-cobalt/50"
    >
      <div className="flex items-center justify-between px-3 pt-2">
        <span className="text-[10px] uppercase tracking-wide text-slate-steel">
          Sponsored
        </span>
      </div>
      {ad.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ad.imageUrl} alt="" className="h-28 w-full object-cover ring-1 ring-inset ring-white/10" />
      )}
      <div className="p-3">
        <div className="font-semibold text-ink group-hover:text-cobalt">
          {ad.title}
        </div>
        <p className="mt-0.5 text-sm text-slate">{ad.body}</p>
      </div>
    </a>
  );
}
