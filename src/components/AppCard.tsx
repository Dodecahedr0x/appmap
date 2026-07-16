import Link from "next/link";
import type { AppDTO } from "@/lib/types";
import { formatToken, formatNumber, cn } from "@/lib/utils";
import { TOKEN_SYMBOL } from "@/lib/constants";

/** Compact metric with a label. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-sm font-semibold text-white">{value}</span>
      <span className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </span>
    </div>
  );
}

export function AppCard({ app, rank }: { app: AppDTO; rank?: number }) {
  return (
    <Link
      href={`/app/${app.slug}`}
      className="card group flex flex-col gap-3 p-4 transition-colors hover:border-brand-purple/50"
    >
      <div className="flex items-start gap-3">
        {typeof rank === "number" && (
          <span className="mt-1 w-6 shrink-0 text-center text-sm font-bold text-slate-500">
            {rank}
          </span>
        )}
        <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface-overlay text-lg font-bold text-brand-green">
          {app.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={app.iconUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            app.name.charAt(0).toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold text-white group-hover:text-brand-green">
              {app.name}
            </h3>
            <span className="chip shrink-0 capitalize">{app.category}</span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-sm text-slate-400">
            {app.tagline || app.description}
          </p>
        </div>
      </div>

      {app.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
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
                <span className="text-brand-green">
                  {formatToken(t.stakeTotal, "")}
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto grid grid-cols-4 gap-2 border-t border-surface-border pt-3">
        <Stat label="Rank" value={app.rankScore.toFixed(2)} />
        <Stat label="Votes" value={formatToken(app.voteWeight, "")} />
        <Stat label="Staked" value={formatToken(app.stakeTotal, "")} />
        <Stat label="Views" value={formatNumber(app.viewCount)} />
      </div>
    </Link>
  );
}
