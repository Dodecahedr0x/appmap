"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { useToast } from "@/components/ui/Toaster";
import { ConnectButton } from "@/components/ConnectButton";
import { AppCard } from "@/components/AppCard";
import { TagAutocomplete, type TagOption } from "@/components/explore/TagAutocomplete";
import { cn, slugify } from "@/lib/utils";
import { apiGet, pollUntilIndexed } from "@/lib/txClient";
import { fetchTags } from "@/lib/indexerClient";
import { useCreateAppProgram } from "@/hooks/useCreateAppProgram";
import type { AppDTO } from "@/lib/types";
import type { OpenGraphData } from "@/lib/opengraph";

const MAX_TAGS = 10;
// MAX_TAG_ID_LEN in programs/nebulous_world/src/constants.rs — tag ids are
// on-chain PDA seeds, hard-capped at 32 bytes.
const MAX_TAG_ID_LEN = 32;
// Keep in sync with buildCreateAppTxSchema's tagline/description limits
// (src/lib/validation.ts) — the same bound lib/opengraph.ts's own
// enrichWithOpenGraph truncates to.
const TAGLINE_MAX = 140;
const DESCRIPTION_MAX = 4000;
const OG_DEBOUNCE_MS = 600;
// Kept in sync with .chip-pop's transition duration in globals.css — a
// removed tag stays in `tags` (marked `chip-leaving`) this long so its exit
// can actually play before it's spliced out for real.
const CHIP_EXIT_MS = 150;

interface Props {
  onSuccess: () => void;
}

/**
 * The app-submission form: just a URL and its tags. Everything a card
 * needs to display (name/tagline/description/icon) is pulled live from the
 * URL's own OpenGraph metadata (see /api/og, lib/opengraph.ts) rather than
 * typed by hand — the preview on the right shows exactly what gets
 * submitted. Submitting builds a single on-chain transaction (`init_app` +
 * one `suggest_tag` per tag, see useCreateAppProgram) which the connected
 * wallet signs directly — there is no database write here at all. The
 * `App`/`Tag`/`AppTag` rows only exist once the indexer observes the
 * confirmed transaction — see AGENTS.md.
 */
export function CreateAppForm({ onSuccess }: Props) {
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const { createApp } = useCreateAppProgram();

  const [url, setUrl] = useState("");
  const [og, setOg] = useState<OpenGraphData | null>(null);
  const [ogLoading, setOgLoading] = useState(false);

  const [allTags, setAllTags] = useState<TagOption[]>([]);
  const [tags, setTags] = useState<TagOption[]>([]);
  // Tags mid-removal: still in `tags` (rendered with `chip-leaving`) so their
  // exit transition can play before the actual splice below.
  const [leavingTags, setLeavingTags] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Preloaded once so the tag picker can rank by closeness client-side as
  // the user types, with no round trip per keystroke — see
  // TagAutocomplete's `fuzzy` mode and lib/fuzzy.ts.
  useEffect(() => {
    fetchTags()
      .then((res) => setAllTags(res.tags.map((t) => ({ id: t.id, name: t.name }))))
      .catch(() => {});
  }, []);

  // Debounced live OpenGraph fetch as the URL settles — this is now the
  // ONLY source of the app's name/tagline/description/icon (see previewApp
  // and handleSubmit below), so the preview genuinely shows what the
  // created card will look like rather than a stand-in.
  useEffect(() => {
    const trimmed = url.trim();
    let parsed: URL | null = null;
    try {
      parsed = trimmed ? new URL(trimmed) : null;
    } catch {
      parsed = null;
    }
    if (!parsed) {
      setOg(null);
      setOgLoading(false);
      return;
    }
    let cancelled = false;
    setOgLoading(true);
    const timer = setTimeout(() => {
      apiGet<{ og: OpenGraphData | null }>(`/api/og?url=${encodeURIComponent(parsed!.toString())}`)
        .then((res) => {
          if (!cancelled) setOg(res.og);
        })
        .catch(() => {
          if (!cancelled) setOg(null);
        })
        .finally(() => {
          if (!cancelled) setOgLoading(false);
        });
    }, OG_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [url]);

  function addTag(t: TagOption) {
    if (tags.length >= MAX_TAGS || tags.some((x) => x.id === t.id)) return;
    setTags((prev) => [...prev, t]);
  }

  function createTag(raw: string) {
    const id = slugify(raw).slice(0, MAX_TAG_ID_LEN);
    if (!id) return;
    addTag({ id, name: raw.trim() });
  }

  function removeTag(id: string) {
    setLeavingTags((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setTags((prev) => prev.filter((t) => t.id !== id));
      setLeavingTags((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, CHIP_EXIT_MS);
  }

  // The app's own https:// url with the protocol trimmed off, same as what
  // the indexer stores on-chain and falls back to as a name when no memo
  // name is given (see programs/nebulous_world's AppAccount.url and
  // indexer/src/processors/product.rs's sync_app_from_init) — so this
  // fallback matches what the real card will show even when OpenGraph
  // comes back empty.
  const strippedUrl = url.trim().replace(/^https?:\/\//, "");
  const ogTagline = (og?.description ?? "").trim().slice(0, TAGLINE_MAX);
  const ogDescription = (og?.description ?? "").trim().slice(0, DESCRIPTION_MAX);

  // Mirrors what the indexer will eventually store (see useCreateAppProgram
  // and buildCreateAppTxSchema) so the preview never lies about what the
  // real card will show once the transaction is indexed.
  const previewApp: AppDTO = useMemo(
    () => ({
      id: "preview",
      slug: "preview",
      name: og?.title?.trim() || strippedUrl || "Your app name",
      tagline: ogTagline,
      description: ogDescription,
      url: url.trim(),
      iconUrl: og?.imageUrl?.trim() || null,
      category: "other",
      chain: "solana",
      status: "pending",
      createdAt: "",
      submittedBy: null,
      voteCount: 0,
      voteWeight: 0,
      stakeTotal: 0,
      viewCount: 0,
      rankScore: 0,
      tags: tags.map((t) => ({
        id: t.id,
        tagId: t.id,
        slug: t.id,
        name: t.name,
        stakeTotal: 0,
        suggestedBy: null,
      })),
    }),
    [og, strippedUrl, ogTagline, ogDescription, url, tags],
  );

  const canSubmit = url.trim().length > 0 && !busy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      // Client-chosen, since it seeds the on-chain AppAccount PDA before
      // any Postgres row exists — see MAX_APP_ID_LEN (32 bytes). A v4 UUID
      // with its dashes stripped is exactly 32 hex characters, so it fits
      // with no truncation/collision-retry logic needed.
      const appId = crypto.randomUUID().replace(/-/g, "");
      const txSig = await createApp({
        appId,
        url: url.trim(),
        tags: tags.map((t) => t.id),
        name: og?.title?.trim() || undefined,
        tagline: ogTagline || undefined,
        description: ogDescription || undefined,
        iconUrl: og?.imageUrl?.trim() || undefined,
      });

      const indexed = await pollUntilIndexed<AppDTO>(`/api/apps/by-id/${appId}`);
      toast.success(indexed ? `${indexed.name} is live` : "App created — indexing…", { txSig });
      onSuccess();
      // Land the creator straight on the app's own page — that's where
      // voting and tag staking actually live (VotePanel/TagStakePanel on
      // app/[slug]/page.tsx), so this is the flow's "way to stake to the
      // app and its tags" rather than duplicating that UI inside the modal.
      if (indexed) router.push(`/app/${indexed.slug}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not create the app",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!user) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate">Sign in to submit an app.</p>
        <ConnectButton />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="app-url" className="text-sm font-medium text-ink">
            URL
          </label>
          <input
            id="app-url"
            type="url"
            className="input mt-1"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            maxLength={300}
            required
            placeholder="https://jup.ag"
          />
          <p className="mt-1 text-xs text-slate-steel">
            {ogLoading
              ? "Loading preview…"
              : "We pull the name, description, and image straight from the site."}
          </p>
        </div>

        <div>
          <label htmlFor="app-tags" className="text-sm font-medium text-ink">
            Tags{" "}
            <span className="font-normal text-slate-steel">
              (optional, up to {MAX_TAGS})
            </span>
          </label>
          <div className="mt-1">
            <TagAutocomplete
              options={allTags}
              excludeIds={tags.map((t) => t.id)}
              onSelect={(id) => {
                const existing = allTags.find((t) => t.id === id);
                if (existing) addTag(existing);
              }}
              onCreate={createTag}
              allowCreate={tags.length < MAX_TAGS}
              disabled={tags.length >= MAX_TAGS}
              fuzzy
              placeholder={
                tags.length >= MAX_TAGS ? `${MAX_TAGS} tags added` : "defi"
              }
              ariaLabel="Search or create a tag"
            />
          </div>
          {tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => removeTag(t.id)}
                  disabled={leavingTags.has(t.id)}
                  className={cn(
                    "chip chip-active chip-pop",
                    leavingTags.has(t.id) && "chip-leaving",
                  )}
                  title="Remove"
                >
                  #{t.name} ✕
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="submit"
          className="btn-primary w-full"
          disabled={!canSubmit}
        >
          {busy ? "Creating…" : "Create app"}
        </button>
      </form>

      <div className="lg:sticky lg:top-0">
        <p className="text-sm font-medium text-ink">Preview</p>
        <p className="mt-0.5 text-xs text-slate-steel">
          How this will look on Discover once it&apos;s live.
        </p>
        <div className="mt-2 max-w-sm">
          <AppCard app={previewApp} preview />
        </div>
      </div>
    </div>
  );
}
