# nebulous.world docs

A [Mintlify](https://mintlify.com) documentation site — statically
generated, no server of its own — explaining what nebulous.world is (see
`introduction.mdx`, `concepts/`) and how to use its
[x402](https://www.x402.org)-priced data API (`api-reference/`). Linked
from the footer of every page in the main app (see
`app/src/lib/constants.ts`'s `SITE_DOCS_URL`).

`docs.json` is the site's nav/theme config; every other file is an `.mdx`
page. Content facts (pricing, token mechanics, on-chain behavior) should
stay in sync with their sources of truth — `app/src/lib/x402.ts` for
pricing, the root `README.md` for the token launch mechanism — rather than
being duplicated as a second, driftable copy.

## Requirements

The Mintlify CLI does not support Node 25+ (fails immediately with `mintlify
is not supported on node versions 25+`). Use an LTS version, e.g. via nvm:

```bash
nvm use 22
```

## Preview locally

```bash
npm run docs:dev   # from the repo root — equivalent to: cd docs-site && npx mintlify dev
```

Opens a live-reloading preview (default `http://localhost:3000` — stop the
main app's dev server first, or it'll be busy).

## Export a static build

```bash
npm run docs:export   # from the repo root — writes docs-site-export.zip
```

This is Mintlify's own "export a static site for air-gapped deployment"
command: the zip contains a fully static HTML/JS/CSS site (a `serve.js`
helper is bundled in it for local serving — `node serve.js` from the
unzipped folder) that can be hosted on literally any static file host, no
Mintlify account required to serve it.

## Deploying

**render.yaml** already defines a `nebulous-world-docs` static site service
that builds this folder with `mintlify export` and publishes the result —
see that file's comments. Connecting this repo to a Render Blueprint (or
running `render blueprint launch`) picks it up alongside the main app and
indexer services; nothing further to configure beyond an optional custom
domain.

If a real docs domain is attached (Render's static sites, a Mintlify-hosted
deployment, or anything else), set `NEXT_PUBLIC_DOCS_URL` on the main app to
point at it — see `app/src/lib/constants.ts`. Left unset, the footer's Docs
link defaults to the `nebulous-world-docs` Render service's own
`onrender.com` URL.

## Validating changes

```bash
cd docs-site
npx mintlify broken-links   # checks every internal/external link resolves
npx mintlify validate       # strict-mode build validation
```

Both are cheap enough to run before committing any content change.
