"use client";

import { useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { useToast } from "@/components/ui/Toaster";
import { ConnectButton } from "@/components/ConnectButton";
import { cn } from "@/lib/utils";
import { CATEGORIES, CHAINS } from "@/lib/constants";

const MAX_TAGS = 10;
// Kept in sync with .chip-pop's transition duration in globals.css — a
// removed tag stays in `tags` (marked `chip-leaving`) this long so its exit
// can actually play before it's spliced out for real.
const CHIP_EXIT_MS = 150;

interface Props {
  onSuccess: () => void;
}

/**
 * The app-submission form — collects exactly what POST /api/apps'
 * submitAppSchema accepts. Only name/url are required; tagline/description/
 * iconUrl are auto-filled from the URL's own OpenGraph data server-side if
 * left blank (see enrichWithOpenGraph), so leaving them blank is a normal,
 * supported path, not a shortcut.
 */
export function CreateAppForm({ onSuccess }: Props) {
  const { user } = useAuth();
  const toast = useToast();

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

  const canSubmit = name.trim().length >= 2 && url.trim().length > 0 && !busy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const res = await fetch("/api/apps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          url: url.trim(),
          tagline: tagline.trim(),
          description: description.trim(),
          iconUrl: iconUrl.trim(),
          category,
          chain,
          tags,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Could not create the app");
      toast.success(`${json.data.app.name} is live`);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the app");
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
          <label htmlFor="app-category" className="text-sm font-medium text-ink">
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
          Tagline <span className="font-normal text-slate-steel">(optional)</span>
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
        <label htmlFor="app-description" className="text-sm font-medium text-ink">
          Description <span className="font-normal text-slate-steel">(optional)</span>
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
          Icon URL <span className="font-normal text-slate-steel">(optional)</span>
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
          Tags <span className="font-normal text-slate-steel">(optional, up to {MAX_TAGS})</span>
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
                className={cn("chip chip-active chip-pop", leavingTags.has(t) && "chip-leaving")}
                title="Remove"
              >
                #{t} ✕
              </button>
            ))}
          </div>
        )}
      </div>

      <button type="submit" className="btn-primary w-full" disabled={!canSubmit}>
        {busy ? "Creating…" : "Create app"}
      </button>
    </form>
  );
}
