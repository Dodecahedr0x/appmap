"use client";

import { useAdServe } from "@/hooks/useAdServe";

/**
 * A sponsored slot styled to match AppCard exactly (same hero-image aspect
 * ratio, title strip, card chrome) so it can be interleaved directly into an
 * app grid — see AD_EVERY_N_APPS — without breaking the grid's rhythm.
 *
 * `appId` attributes this impression's revenue to that app (AdImpression is
 * always tied to one app — see indexer/migrations/005_app_schema.sql), same as AdSlot on the app
 * detail page. In a grid there's no single "current app", so callers pass
 * the app whose card immediately precedes this slot; see interleaveAds.
 */
export function AdCard({ appId }: { appId: string }) {
  const { ad, onClick } = useAdServe(appId);

  if (!ad) {
    return (
      <div className="card flex flex-col overflow-hidden">
        <div className="grid aspect-[1200/630] w-full shrink-0 place-items-center bg-mist text-xs text-slate-steel">
          Sponsored
        </div>
        <div className="border-t border-hairline bg-ivory/60 px-4 py-3">
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-steel">
            Sponsored
          </span>
        </div>
      </div>
    );
  }

  return (
    <a
      href={ad.targetUrl}
      target="_blank"
      rel="noopener noreferrer sponsored"
      onClick={onClick}
      className="card group animate-fade-in flex flex-col overflow-hidden transition-colors hover:border-cobalt/40"
    >
      <div className="relative aspect-[1200/630] w-full shrink-0 overflow-hidden bg-mist">
        {ad.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ad.imageUrl}
            alt=""
            className="h-full w-full object-cover ring-1 ring-inset ring-white/10 transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-4xl font-bold text-violet">
            Ad
          </div>
        )}
        <span className="chip absolute right-2.5 top-2.5 border-none bg-ivory/90 capitalize">
          Sponsored
        </span>
      </div>

      <div className="border-t border-hairline bg-ivory/60 px-4 py-3">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-steel">
          Sponsored
        </span>
        <h3 className="mt-0.5 truncate text-base font-bold text-ink group-hover:text-cobalt">
          {ad.title}
        </h3>
        <p className="mt-0.5 line-clamp-2 text-sm text-slate">{ad.body}</p>
      </div>
    </a>
  );
}
