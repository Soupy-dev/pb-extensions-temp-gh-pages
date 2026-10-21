// Assembles the combined Paperback 0.8 extension repository that GitHub Pages
// serves. It takes the two extensions maintained in this repo — Kagane (built
// from TypeScript under kitty-extensions-0.8-temp-main/) and ComixTo (a
// hand-maintained compiled bundle under 0.8/ComixTo/) — and lays them out as a
// single repository under _site/:
//
//   _site/versioning.json          lists both sources
//   _site/index.html               human landing page with an "Add to Paperback" button
//   _site/Kagane/source.js         + includes/
//   _site/ComixTo/source.js        + includes/
//
// Run it after Kagane has been bundled (`npx paperback bundle` in the Kagane
// toolchain dir). The CI workflow does both steps; locally:
//   (cd kitty-extensions-0.8-temp-main && npm ci && npx paperback bundle)
//   node tools/build-site.mjs
//   npx serve _site        # optional preview
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "_site");

// Where each extension's built artifacts and catalog metadata live.
const KAGANE_BUNDLES = join(ROOT, "kitty-extensions-0.8-temp-main", "bundles");
const COMIX_DIR = join(ROOT, "0.8");

// Base URL the repository will be served from. Paperback fetches
// `<baseURL>/versioning.json` and `<baseURL>/<id>/source.js`, so it must match
// the Pages URL exactly. Derived from the repo on CI; override with
// SITE_BASE_URL when previewing or serving from somewhere else.
function resolveBaseURL() {
  if (process.env.SITE_BASE_URL) return process.env.SITE_BASE_URL.replace(/\/$/, "");
  const repo = process.env.GITHUB_REPOSITORY;
  if (repo) {
    const [owner, name] = repo.split("/");
    // GitHub serves project Pages from the lower-cased owner sub-domain.
    return `https://${owner.toLowerCase()}.github.io/${name}`;
  }
  return "";
}

const REPO_NAME = process.env.SITE_REPO_NAME ?? "Soupy Paperback Extensions";
const REPO_DESC =
  process.env.SITE_REPO_DESC ??
  "Personal builds of the Kagane and ComixTo extensions for Paperback 0.8. Not for public use.";
const baseURL = resolveBaseURL();

function readSources(versioningPath) {
  const data = JSON.parse(readFileSync(versioningPath, "utf8"));
  return { data, sources: data.sources ?? [] };
}

const kagane = readSources(join(KAGANE_BUNDLES, "versioning.json"));
const comix = readSources(join(COMIX_DIR, "versioning.json"));

// Rebuild a clean output tree.
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Copy each source's payload under its id, exactly as Paperback expects.
cpSync(join(KAGANE_BUNDLES, "Kagane"), join(OUT, "Kagane"), { recursive: true });
cpSync(join(COMIX_DIR, "ComixTo"), join(OUT, "ComixTo"), { recursive: true });

const sources = [...kagane.sources, ...comix.sources].sort((a, b) =>
  a.name.localeCompare(b.name),
);

const versioning = {
  buildTime: new Date().toISOString(),
  sources,
  // The toolchain that produced the TypeScript source bundle.
  builtWith: kagane.data.builtWith ?? comix.data.builtWith ?? { toolchain: "0.8.7", types: "0.8.7" },
};
writeFileSync(join(OUT, "versioning.json"), JSON.stringify(versioning));

// ComixTo follows comix's signer rotation by fetching this file at runtime (see
// tools/comix-keys). CI extracts it ahead of the build and points COMIX_KEYS_FILE at it;
// without one the extension simply keeps the constants baked into its bundle.
const comixKeys = process.env.COMIX_KEYS_FILE;
if (comixKeys && existsSync(comixKeys)) {
  cpSync(comixKeys, join(OUT, "comix-keys.json"));
  console.log(`comix-keys.json: build ${JSON.parse(readFileSync(comixKeys, "utf8")).build}`);
} else {
  console.log("comix-keys.json: none (extension uses its baked-in constants)");
}

// --- Landing page -----------------------------------------------------------
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

const addLink = baseURL
  ? `paperback://addRepo?displayName=${encodeURIComponent(REPO_NAME)}&url=${encodeURIComponent(baseURL)}`
  : "";

const cards = sources
  .map(
    (s) => `
      <article class="card">
        <img class="icon" src="${esc(s.id)}/includes/${esc(s.icon ?? "icon.png")}" alt="" loading="lazy" width="56" height="56">
        <div class="meta">
          <h3>${esc(s.name)}</h3>
          <p>${esc(s.desc ?? "")}</p>
          <div class="tags">
            <span class="tag">v${esc(s.version)}</span>
            <span class="tag rating-${esc((s.contentRating ?? "").toLowerCase())}">${esc(s.contentRating ?? "")}</span>
            ${s.websiteBaseURL ? `<a class="tag link" href="${esc(s.websiteBaseURL)}" rel="noreferrer noopener">site ↗</a>` : ""}
          </div>
        </div>
      </article>`,
  )
  .join("");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(REPO_NAME)}</title>
<style>
:root{--bg:#0f1115;--panel:#171a21;--line:#252a34;--text:#e8eaed;--dim:#98a1b3;--accent:#f2545b;--accent-ink:#fff}
@media(prefers-color-scheme:light){:root{--bg:#f6f7f9;--panel:#fff;--line:#e3e6ec;--text:#14171c;--dim:#5c6675}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:820px;margin:0 auto;padding:48px 20px 72px}
header{text-align:center;margin-bottom:36px}
h1{font-size:1.9rem;margin:0 0 8px;letter-spacing:-.02em}
.sub{color:var(--dim);margin:0}
.install{display:flex;flex-direction:column;align-items:center;gap:12px;margin:28px 0 40px}
.btn{display:inline-block;background:var(--accent);color:var(--accent-ink);text-decoration:none;font-weight:600;padding:13px 28px;border-radius:10px}
.btn:hover{filter:brightness(1.08)}
.url{width:100%;max-width:560px;display:flex;gap:8px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.url code{flex:1;overflow-x:auto;white-space:nowrap;font-size:.86rem;color:var(--dim)}
.url button{background:transparent;border:1px solid var(--line);color:var(--text);border-radius:7px;padding:5px 11px;font-size:.8rem;cursor:pointer}
.url button:hover{border-color:var(--accent)}
h2{font-size:.78rem;text-transform:uppercase;letter-spacing:.09em;color:var(--dim);margin:0 0 14px;font-weight:600}
.grid{display:grid;gap:12px}
.card{display:flex;gap:14px;align-items:flex-start;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}
.icon{border-radius:10px;flex-shrink:0;object-fit:cover;background:var(--line)}
.meta{min-width:0}
.meta h3{margin:0 0 3px;font-size:1.02rem}
.meta p{margin:0 0 9px;color:var(--dim);font-size:.87rem}
.tags{display:flex;flex-wrap:wrap;gap:6px}
.tag{font-size:.72rem;padding:3px 9px;border-radius:999px;border:1px solid var(--line);color:var(--dim);text-decoration:none}
.tag.link:hover{border-color:var(--accent);color:var(--text)}
.rating-mature{border-color:#8a5a2b;color:#d79a5b}
.rating-adult{border-color:#8a2b3a;color:#e0788a}
.note{margin-top:28px;font-size:.84rem;color:var(--dim);border-left:.2rem solid var(--line);padding:.25rem 0 .25rem 1rem}
footer{margin-top:40px;text-align:center;color:var(--dim);font-size:.8rem}
footer a{color:var(--dim)}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${esc(REPO_NAME)}</h1>
    <p class="sub">${esc(REPO_DESC)}</p>
  </header>

  <div class="install">
    ${addLink ? `<a class="btn" href="${esc(addLink)}">Add to Paperback</a>` : ""}
    <div class="url">
      <code id="u">${esc(baseURL)}</code>
      <button onclick="navigator.clipboard&&navigator.clipboard.writeText(document.getElementById('u').textContent).then(()=>{this.textContent='Copied'})">Copy</button>
    </div>
  </div>

  <h2>${sources.length} source${sources.length === 1 ? "" : "s"}</h2>
  <div class="grid">${cards}
  </div>

  <p class="note">Personal-use repository: please don't add it to your own Paperback.
  These builds aren't maintained by the original authors and may break or be
  removed at any time. On my own devices, tap <strong>Add to Paperback</strong>,
  or paste the base URL above into Settings → Extensions → add a repository.
  If the older Kagane or ComixTo repositories are still added, remove them so
  updates come from here.</p>

  <footer>Paperback 0.8 · built ${esc(new Date().toISOString().slice(0, 10))}</footer>
</div>
</body>
</html>
`;
writeFileSync(join(OUT, "index.html"), html);

console.log(
  `_site built: ${sources.length} sources (${sources.map((s) => `${s.name} v${s.version}`).join(", ")})`,
);
console.log(`baseURL: ${baseURL || "(unset — pass SITE_BASE_URL or run in CI)"}`);
