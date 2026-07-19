// Vanilla JS, no build step, no framework — see server.ts's header comment
// for why. Two tabs share one `renderAppCard`/`renderTagEditor` pair: Review
// renders every app in apps.json with tags that save on edit; Expand renders
// freshly-discovered candidates with the same tag editor plus a checkbox,
// letting the user tweak tags *before* anything is written to disk.

const state = { apps: [], filter: "" };

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function toast(message, isError) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = isError ? "toast error show" : "toast show";
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => el.classList.remove("show"), 3000);
}

// ---------------------------------------------------------------------
// Shared app card + tag editor
// ---------------------------------------------------------------------

/** `onTagsChange` fires on every add/remove with the FULL updated tag list
    (not a delta) — simplest contract for callers, and matches how the
    server's PATCH endpoint replaces the whole array rather than diffing. */
function renderTagEditor(initialTags, editable, onTagsChange) {
  let tags = [...initialTags];
  const wrap = document.createElement("div");
  wrap.className = "tag-editor";

  function redraw() {
    wrap.innerHTML = "";
    for (const tag of tags) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.dataset.tag = tag;
      chip.textContent = tag;
      if (editable) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "chip-remove";
        remove.setAttribute("aria-label", `Remove tag ${tag}`);
        remove.textContent = "×";
        remove.onclick = () => {
          tags = tags.filter((t) => t !== tag);
          onTagsChange(tags);
          redraw();
        };
        chip.appendChild(remove);
      }
      wrap.appendChild(chip);
    }
    if (editable) {
      const addInput = document.createElement("input");
      addInput.className = "chip-add";
      addInput.placeholder = "+ tag";
      addInput.setAttribute("aria-label", "Add a tag");
      addInput.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const value = addInput.value.trim().toLowerCase();
        addInput.value = "";
        if (!value || tags.includes(value)) return;
        tags = [...tags, value];
        onTagsChange(tags);
        redraw();
      });
      wrap.appendChild(addInput);
    }
  }
  redraw();
  wrap.getTags = () => tags;
  return wrap;
}

/** `opts.checkbox` (Expand tab only) adds a leading checkbox; the returned
    element exposes `.getChecked()`/`.getTags()` so the caller can collect
    approved candidates (with whatever tag edits were made) without the
    caller needing to know this card's internal DOM shape. */
function renderAppCard(app, opts) {
  const card = document.createElement("div");
  card.className = "app-card";

  let checkbox = null;
  if (opts.checkbox) {
    checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.className = "app-card-checkbox";
    checkbox.setAttribute("aria-label", `Include ${app.name || app.url}`);
    card.appendChild(checkbox);
  }

  const body = document.createElement("div");
  body.className = "app-card-body";

  const header = document.createElement("div");
  header.className = "app-card-header";
  const link = document.createElement("a");
  link.className = "app-name";
  link.href = app.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = app.name || app.url;
  header.appendChild(link);
  const meta = document.createElement("span");
  meta.className = "app-meta";
  meta.textContent = [app.category, app.chain].filter(Boolean).join(" · ");
  header.appendChild(meta);
  body.appendChild(header);

  if (app.tagline) {
    const tagline = document.createElement("p");
    tagline.className = "app-tagline";
    tagline.textContent = app.tagline;
    body.appendChild(tagline);
  }

  const tagEditor = renderTagEditor(app.tags || [], opts.editable !== false, (tags) => {
    if (opts.onTagsChange) opts.onTagsChange(tags);
  });
  body.appendChild(tagEditor);

  card.appendChild(body);
  card.getChecked = () => (checkbox ? checkbox.checked : true);
  card.getTags = () => tagEditor.getTags();
  card._app = app;
  return card;
}

// ---------------------------------------------------------------------
// Review tab
// ---------------------------------------------------------------------

async function fetchApps() {
  const res = await fetch("/api/apps");
  const data = await res.json();
  state.apps = data.apps || [];
  renderReview();
}

function matchesFilter(app, q) {
  if (!q) return true;
  const haystack = [app.name, app.url, ...(app.tags || [])].join(" ").toLowerCase();
  return haystack.includes(q);
}

function renderReview() {
  const list = document.getElementById("review-list");
  const q = state.filter.trim().toLowerCase();
  const filtered = state.apps.filter((app) => matchesFilter(app, q));
  document.getElementById("review-count").textContent = `${filtered.length} of ${state.apps.length} apps`;
  list.innerHTML = "";
  for (const app of filtered) {
    list.appendChild(renderAppCard(app, { editable: true, onTagsChange: (tags) => saveTags(app, tags) }));
  }
}

// One timer per app URL — editing two apps' tags in quick succession must
// not let the second app's debounce cancel the first's pending save.
const saveTimers = new Map();
function saveTags(app, tags) {
  app.tags = tags;
  clearTimeout(saveTimers.get(app.url));
  saveTimers.set(
    app.url,
    setTimeout(async () => {
      try {
        const res = await fetch(`/api/apps/${encodeURIComponent(app.url)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tags }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "save failed");
        toast(`Saved tags for ${app.name || app.url}`);
      } catch (err) {
        toast(`Failed to save ${app.name || app.url}: ${err.message}`, true);
      }
    }, 250),
  );
}

document.getElementById("review-search").addEventListener("input", (e) => {
  state.filter = e.target.value;
  renderReview();
});

// ---------------------------------------------------------------------
// Expand tab
// ---------------------------------------------------------------------

let expandCards = [];

document.getElementById("expand-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const tag = document.getElementById("expand-tag").value.trim();
  if (!tag) return;
  const count = Number(document.getElementById("expand-count").value) || 8;
  const model = document.getElementById("expand-model").value.trim() || "sonnet";
  const effort = document.getElementById("expand-effort").value;

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const statusEl = document.getElementById("expand-status");
  const resultsEl = document.getElementById("expand-results");
  const actionsEl = document.getElementById("expand-actions");

  submitBtn.disabled = true;
  statusEl.textContent = `Asking claude for apps tagged "${escapeHtml(tag)}"… this can take up to ~2 minutes.`;
  resultsEl.innerHTML = "";
  actionsEl.hidden = true;
  expandCards = [];

  try {
    const res = await fetch("/api/discover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tag, count, model, effort }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "discovery failed");

    if (data.apps.length === 0) {
      statusEl.textContent = "Nothing new found — every suggestion was already in apps.json.";
    } else {
      statusEl.textContent = `${data.apps.length} new app(s) found. Uncheck any you don't want, edit tags if needed, then add.`;
      for (const app of data.apps) {
        const card = renderAppCard(app, { editable: true, checkbox: true });
        resultsEl.appendChild(card);
        expandCards.push(card);
      }
      actionsEl.hidden = false;
    }
  } catch (err) {
    statusEl.textContent = `Failed: ${err.message}`;
  } finally {
    submitBtn.disabled = false;
  }
});

document.getElementById("expand-approve").addEventListener("click", async () => {
  const approveBtn = document.getElementById("expand-approve");
  const approved = expandCards
    .filter((card) => card.getChecked())
    .map((card) => ({ ...card._app, tags: card.getTags() }));
  if (approved.length === 0) {
    toast("Nothing checked to add", true);
    return;
  }
  approveBtn.disabled = true;
  try {
    const res = await fetch("/api/discover/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apps: approved }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "approve failed");
    toast(`Added ${data.added} app(s) (${data.skipped} already existed) — ${data.total} total in apps.json`);
    document.getElementById("expand-results").innerHTML = "";
    document.getElementById("expand-actions").hidden = true;
    document.getElementById("expand-status").textContent = "";
    expandCards = [];
    await fetchApps();
  } catch (err) {
    toast(`Failed: ${err.message}`, true);
  } finally {
    approveBtn.disabled = false;
  }
});

// ---------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------

document.querySelectorAll('[role="tab"]').forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll('[role="tab"]').forEach((b) => b.setAttribute("aria-selected", "false"));
    btn.setAttribute("aria-selected", "true");
    document.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = true));
    document.getElementById(`tab-${btn.dataset.tab}`).hidden = false;
  });
});

fetchApps();
