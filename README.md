# Soupy Paperback Extensions

**Personal repository. Please don't add it to your own Paperback.**

This is where I keep two **Paperback 0.8** extensions, **Kagane** and
**ComixTo**, working for my own devices after the sites they read from changed.
I got tired of the originals breaking and patch them here instead.

- It isn't a public extension repository and isn't meant for anyone else's setup.
- The extensions aren't maintained by their original authors, and I'm not
  affiliated with them or with the sites they read from.
- No support, no stability promises. Anything here can change, break or be
  removed at any time.

## My install

On my iPhone/iPad, in Paperback: **Settings → Extensions → Add Repository**, then
paste this base URL:

```
https://soupy-dev.github.io/pb-extensions-temp-gh-pages
```

The same thing as a one-tap link (also what the button on the repository's landing
page uses):

```
paperback://addRepo?displayName=Soupy%20Paperback%20Extensions&url=https%3A%2F%2Fsoupy-dev.github.io%2Fpb-extensions-temp-gh-pages
```

## Extensions

| Extension | Reads from | Content |
| --------- | ---------- | ------- |
| **Kagane** | kagane.si (and mirrors) | Mature |
| **ComixTo** | comix.to | Everyone |

I use Kagane for my library and ComixTo mostly for discovery.

## Notes to self

### How it's built and served

The repository Paperback reads is built and published by GitHub Actions
([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)) on every push to
`main`, and served from GitHub Pages. Nothing in `_site/` is committed; it is
generated.

Layout:

- `kitty-extensions-0.8-temp-main/` — Kagane TypeScript source + Paperback
  toolchain. Edit `src/Kagane/*.ts`; the build runs `npx paperback bundle`.
- `0.8/ComixTo/source.js` — ComixTo compiled bundle (no TypeScript source).
  Edit it directly; bump `version` in both the bundle's `ComixToInfo` and
  `0.8/versioning.json`.
- `tools/build-site.mjs` — assembles both into the combined `_site/` repository
  (merged `versioning.json`, per-source `source.js` + `includes/`, and the
  landing page).
- `tools/comix-keys/` — the ComixTo signing-key extractor (see below).

Build and preview locally:

```sh
(cd kitty-extensions-0.8-temp-main && npm ci && npx paperback bundle)
SITE_BASE_URL="https://soupy-dev.github.io/pb-extensions-temp-gh-pages" node tools/build-site.mjs
npx serve _site
```

After editing a source and pushing to `main`, the live repository updates on its
own; Paperback picks up the new version on its next repository refresh.

### ComixTo: request limits

Measured against the live site (Oct 2026). Comix answers every request of a session
with `503 third_party_app` for several minutes once it sees chapter-list traffic no
real reader produces. `GET /manga/{id}/chapters` must use `limit` ≤ 40 (50+ trips it
on the next request) and at most 3 `page ≥ 2` requests per ~35 s (the 4th trips it).
Page 1 — in either sort order, with or without `group_id` or `number` filters —
details, listings and chapter pages are not limited.

### ComixTo: duplicate chapters

Comix keeps one chapter entry per scanlation group, so a 41-chapter series can have
500+ entries. By default (setting "Merge Duplicate Chapters") `getChapters` therefore
works from a single group's list: it probes the busiest groups' page 1 to find the one
with the most chapters, takes that group's newest 40 plus oldest 40 (the whole list for
up to 80 chapters with no budgeted request), pages the middle of longer lists within the
page budget, and fills missing chapter numbers from other groups or by `number` lookup.
Progress is cached per title, so a very long series completes over a few opens. With the
setting off it lists every group's upload but can only reach the newest part of a long
series.

### ComixTo: signing keys

Comix rebuilds its request-signing script about every 14 hours with a new token prefix,
HMAC key and response key, and answers `403 key_retired` for keys more than about one
generation old. `tools/comix-keys/extract.mjs` recovers the current constants from the
site's own script (it runs the script in headless Chromium and checks the result against
the script's output before accepting it). The workflow runs it every three hours, and the
deploy publishes `comix-keys.json` next to the extensions. ComixTo fetches that file at
runtime and adopts it when its build is newer than the constants baked into the bundle,
so a rotation needs no extension update.

To run it by hand (needs Chrome/Chromium/Edge; set `CHROME_PATH` if it isn't found):

```sh
(cd tools/comix-keys && npm ci && node extract.mjs --out comix-keys.json)
```

If extraction ever fails (comix blocking the runner, or the script's layout changing),
the last published keys stay in place and the Actions run shows a warning. Refresh the
baked-in constants in `0.8/ComixTo/source.js` from the tool's output when I next touch
the bundle.
