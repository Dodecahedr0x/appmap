"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { useToast } from "@/components/ui/Toaster";
import { ConnectButton } from "@/components/ConnectButton";
import { AppCard } from "@/components/AppCard";
import { cn } from "@/lib/utils";
import { pollUntilIndexed } from "@/lib/txClient";
import { useCreateAppProgram } from "@/hooks/useCreateAppProgram";
import { CATEGORIES, CHAINS } from "@/lib/constants";
import type { AppDTO } from "@/lib/types";

const MAX_TAGS = 10;
// Kept in sync with .chip-pop's transition duration in globals.css — a
// removed tag stays in `tags` (marked `chip-leaving`) this long so its exit
// can actually play before it's spliced out for real.
const CHIP_EXIT_MS = 150;

interface Props {
  onSuccess: () => void;
}

/**
 * The app-submission form. Only name/url are required; everything else is
 * optional. Submitting builds a single on-chain transaction (`init_app` +
 * one `suggest_tag` per initial tag, see useCreateAppProgram) which the
 * connected wallet signs directly — there is no database write here at
 * all. The `App`/`Tag`/`AppTag` rows (and any OpenGraph-derived
 * tagline/description/icon left blank here) only exist once the indexer
 * observes the confirmed transaction and, later, `og:backfill` fills in
 * imagery — see AGENTS.md.
 */
export function CreateAppForm({ onSuccess }: Props) {
  const { user } = useAuth();
  const toast = useToast();
  const { createApp } = useCreateAppProgram();

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [iconUrl, setIconUrl] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [chain, setChain] = useState<string>("solana");
  const [tags, setTags] = useState<string[]>([]);
  // Tags mid-removal: still in `tags` (rendered with `chip-leaving`) so their
  // exit transition can play before the actual splice below.
  const [leavingTags, setLeavingTags] = useState<Set<string>>(new Set());
  const [tagInput, setTagInput] = useState("");
  const [busy, setBusy] = useState(false);

  function addTag() {
    const t = tagInput.trim().toLowerCase();
    if (!t || tags.includes(t) || tags.length >= MAX_TAGS) {
      setTagInput("");
      return;
    }
    setTags((prev) => [...prev, t]);
    setTagInput("");
  }

  function removeTag(t: string) {
    setLeavingTags((prev) => new Set(prev).add(t));
    setTimeout(() => {
      setTags((prev) => prev.filter((x) => x !== t));
      setLeavingTags((prev) => {
        const next = new Set(prev);
        next.delete(t);
        return next;
      });
    }, CHIP_EXIT_MS);
  }

  // Mirrors what the indexer will eventually store (see
  // useCreateAppProgram/buildCreateAppTxSchema) so the preview never lies
  // about what the real card will show once the transaction is indexed.
  const previewApp: AppDTO = useMemo(
    () => ({
      id: "preview",
      slug: "preview",
      name: name.trim() || "Your app name",
      tagline: tagline.trim(),
      description: description.trim(),
      url: url.trim(),
      iconUrl: iconUrl.trim() || null,
      category,
      chain,
      status: "pending",
      createdAt: "",
      submittedBy: null,
      voteCount: 0,
      voteWeight: 0,
      stakeTotal: 0,
      viewCount: 0,
      rankScore: 0,
      tags: tags.map((t) => ({
        id: t,
        tagId: t,
        slug: t,
        name: t,
        stakeTotal: 0,
        suggestedBy: null,
      })),
    }),
    [name, tagline, description, url, iconUrl, category, chain, tags],
  );

  const canSubmit = name.trim().length >= 2 && url.trim().length > 0 && !busy;

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
        tags,
        name: name.trim() || undefined,
        tagline: tagline.trim() || undefined,
        description: description.trim() || undefined,
        iconUrl: iconUrl.trim() || undefined,
        category,
        chain,
      });

      const indexed = await pollUntilIndexed<{ app: { name: string } }>(
        `/api/apps/by-id/${appId}`,
      );
      toast.success(
        indexed ? `${indexed.app.name} is live` : "App created — indexing…",
        { txSig },
      );
      onSuccess();
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
          <label htmlFor="app-name" className="text-sm font-medium text-ink">
            Name
          </label>
          <input
            id="app-name"
            className="input mt-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            placeholder="Jupiter"
          />
        </div>

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
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="app-category"
              className="text-sm font-medium text-ink"
            >
              Category
            </label>
            <select
              id="app-category"
              className="input mt-1"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="app-chain" className="text-sm font-medium text-ink">
              Chain
            </label>
            <select
              id="app-chain"
              className="input mt-1"
              value={chain}
              onChange={(e) => setChain(e.target.value)}
            >
              {CHAINS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="app-tagline" className="text-sm font-medium text-ink">
            Tagline{" "}
            <span className="font-normal text-slate-steel">(optional)</span>
          </label>
          <input
            id="app-tagline"
            className="input mt-1"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            maxLength={140}
            placeholder="Left blank, we'll pull one from the site itself"
          />
        </div>

        <div>
          <label
            htmlFor="app-description"
            className="text-sm font-medium text-ink"
          >
            Description{" "}
            <span className="font-normal text-slate-steel">(optional)</span>
          </label>
          <textarea
            id="app-description"
            className="input mt-1 min-h-24"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={4000}
          />
        </div>

        <div>
          <label htmlFor="app-icon" className="text-sm font-medium text-ink">
            Icon URL{" "}
            <span className="font-normal text-slate-steel">(optional)</span>
          </label>
          <input
            id="app-icon"
            type="url"
            className="input mt-1"
            value={iconUrl}
            onChange={(e) => setIconUrl(e.target.value)}
            maxLength={300}
            placeholder="Left blank, we'll use the site's own OpenGraph image"
          />
        </div>

        <div>
          <label htmlFor="app-tags" className="text-sm font-medium text-ink">
            Tags{" "}
            <span className="font-normal text-slate-steel">
              (optional, up to {MAX_TAGS})
            </span>
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id="app-tags"
              className="input"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag();
                }
              }}
              maxLength={40}
              placeholder="defi"
              disabled={tags.length >= MAX_TAGS}
            />
            <button
              type="button"
              className="btn-secondary shrink-0"
              onClick={addTag}
              disabled={!tagInput.trim() || tags.length >= MAX_TAGS}
            >
              Add
            </button>
          </div>
          {tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => removeTag(t)}
                  disabled={leavingTags.has(t)}
                  className={cn(
                    "chip chip-active chip-pop",
                    leavingTags.has(t) && "chip-leaving",
                  )}
                  title="Remove"
                >
                  #{t} ✕
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
