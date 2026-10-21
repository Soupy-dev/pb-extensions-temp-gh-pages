# Soupy Paperback Extensions

Maintained builds of two **Paperback 0.8** extensions — **Kagane** and
**ComixTo** — kept working after the sites they read from changed. One
repository installs and updates both.

## Add to Paperback

On your iPhone/iPad with Paperback installed, open the install page and tap
**Add to Paperback**:

### 👉 https://soupy-dev.github.io/pb-extensions-temp-gh-pages/

That adds this repository and makes both extensions available in one step.

Prefer to add it by hand? In Paperback go to **Settings → Extensions →
Add Repository** (or the ⊕ button) and paste this base URL:

```
https://soupy-dev.github.io/pb-extensions-temp-gh-pages
```

The `Add to Paperback` button uses this link, if you want to trigger it manually:

```
paperback://addRepo?displayName=Soupy%20Paperback%20Extensions&url=https%3A%2F%2Fsoupy-dev.github.io%2Fpb-extensions-temp-gh-pages
```

> **Already had the old repos?** If you previously added kittycatgit's Kagane
> repository or acepilot147's ComixTo repository, remove them in
> **Settings → Extensions** so updates come from here instead.

## Extensions

| Extension | Reads from | Content |
| --------- | ---------- | ------- |
| **Kagane** | kagane.si (and mirrors) | Mature |
| **ComixTo** | comix.to | Everyone |

## For maintainers

The repository that Paperback consumes is built and published automatically by
GitHub Actions ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml))
on every push to `main`, and served from GitHub Pages. Nothing in `_site/` is
committed — it is generated.

Layout:

- `kitty-extensions-0.8-temp-main/` — Kagane TypeScript source + Paperback
  toolchain. Edit `src/Kagane/*.ts`; the build runs `npx paperback bundle`.
- `0.8/ComixTo/source.js` — ComixTo compiled bundle (no TypeScript source).
  Edit it directly; bump `version` in both the bundle's `ComixToInfo` and
  `0.8/versioning.json`.
- `tools/build-site.mjs` — assembles both into the combined `_site/` repository
  (merged `versioning.json`, per-source `source.js` + `includes/`, and the
  landing page).

ComixTo notes (measured against the live site, Oct 2026): comix answers every
request of a session with `503 third_party_app` for several minutes once it sees
chapter-list traffic no real reader produces. `GET /manga/{id}/chapters` must use
`limit` ≤ 40 (50+ trips it on the next request) and at most 3 `page ≥ 2` requests per
~35 s (the 4th trips it). Page 1, details, listings and chapter pages are not limited.
`getChapters` therefore pages within that budget and keeps a per-title cache, so a very
long series fills in over a few opens instead of tripping the block.

Build and preview locally:

```sh
(cd kitty-extensions-0.8-temp-main && npm ci && npx paperback bundle)
SITE_BASE_URL="https://soupy-dev.github.io/pb-extensions-temp-gh-pages" node tools/build-site.mjs
npx serve _site
```

After editing a source and pushing to `main`, the live repository updates on its
own; Paperback picks up the new version on its next repository refresh.
