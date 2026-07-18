import Link from "next/link";
import type { AppDTO } from "@/lib/types";
import { formatToken, formatNumber, hostname, cn, topStakedTag } from "@/lib/utils";
import { TOKEN_SYMBOL } from "@/lib/constants";

/** Compact metric with a label. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-sm font-semibold tabular-nums text-ink">
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-wide text-slate-steel">
        {label}
      </span>
    </div>
  );
}

export function AppCard({
  app,
  rank,
  preview = false,
}: {
  app: AppDTO;
  rank?: number;
  /** Renders as an inert div instead of a Link — used for the live preview
      in CreateAppForm, where the card isn't a real, navigable app yet. */
  preview?: boolean;
}) {
  const className = cn(
    "group flex flex-col overflow-hidden",
    preview ? "card" : "card-interactive",
  );
  // Apps have no onchain "category" — the corner badge shows the tag with
  // the most stake behind it instead, or nothing if the app has no tags.
  const topTag = topStakedTag(app.tags);

  const content = (
    <>
      {/* Hero image — the app's own OpenGraph image when available, so the
          card reads like a link preview rather than a bare list row. */}
      <div className="relative aspect-[1200/630] w-full shrink-0 overflow-hidden bg-mist">
        {app.iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={app.iconUrl}
            alt=""
            className="h-full w-full object-cover ring-1 ring-inset ring-white/10 transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-4xl font-bold text-violet">
            {app.name.charAt(0).toUpperCase() || "?"}
          </div>
        )}
        {typeof rank === "number" && (
          <span className="absolute left-2.5 top-2.5 grid h-6 w-6 place-items-center rounded-full bg-cream/80 text-[11px] font-bold text-ink">
            {rank}
          </span>
        )}
        {topTag && (
          <span className="chip absolute right-2.5 top-2.5 border-none bg-ivory/90">
            #{topTag.name}
          </span>
        )}
      </div>

      {/* Domain + title strip, mirroring how a shared link preview unfurls. */}
      <div className="border-t border-hairline bg-ivory/60 px-4 py-3">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-steel">
          {hostname(app.url)}
        </span>
        <h3 className="mt-0.5 truncate text-base font-bold text-ink group-hover:text-cobalt">
          {app.name}
        </h3>
        <p className="mt-0.5 line-clamp-2 text-sm text-slate">
          {app.tagline || app.description}
        </p>
      </div>

      {app.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 py-2">
          {app.tags.slice(0, 5).map((t) => (
            <span
              key={t.id}
              className={cn(
                "chip text-[11px]",
                t.stakeTotal > 0 && "chip-active",
              )}
              title={
                t.stakeTotal > 0
                  ? `${formatToken(t.stakeTotal, TOKEN_SYMBOL)} staked`
                  : "No stake yet"
              }
            >
              #{t.name}
              {t.stakeTotal > 0 && (
                <span className="text-cobalt">
                  {formatToken(t.stakeTotal, "")}
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto grid grid-cols-4 gap-2 border-t border-hairline p-4">
        <Stat label="Rank" value={app.rankScore.toFixed(2)} />
        <Stat label="Votes" value={formatToken(app.voteWeight, "")} />
        <Stat label="Staked" value={formatToken(app.stakeTotal, "")} />
        <Stat label="Views" value={formatNumber(app.viewCount)} />
      </div>
    </>
  );

  if (preview) {
    return <div className={className}>{content}</div>;
  }

  return (
    <Link href={`/app/${app.slug}`} className={className}>
      {content}
    </Link>
  );
}
