import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BUNDLES = "bundles";
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const data = JSON.parse(readFileSync(join(BUNDLES, "versioning.json"), "utf8"));

const repo = process.env.GITHUB_REPOSITORY ?? "";
const [owner, name] = repo.split("/");
const baseURL = pkg.baseURL ?? (owner && name ? `https://${owner}.github.io/${name}` : "");

const title = pkg.repositoryName ?? "Paperback Repository";
const sources = [...(data.sources ?? [])].sort((a, b) => a.name.localeCompare(b.name));
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

const built = data.buildTime
  ? new Date(data.buildTime).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })
  : "";

const cards = sources
  .map(
    (s) => `
      <article class="card">
        <img class="icon" src="${esc(s.id)}/includes/${esc(s.icon)}" alt="" loading="lazy" width="56" height="56">
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
<title>${esc(title)}</title>
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
footer{margin-top:40px;text-align:center;color:var(--dim);font-size:.8rem}
footer a{color:var(--dim)}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${esc(title)}</h1>
    <p class="sub">${esc(pkg.description ?? "")}</p>
  </header>

  <div class="install">
    ${baseURL ? `<a class="btn" href="paperback://addRepo?displayName=${encodeURIComponent(title)}&url=${encodeURIComponent(baseURL)}">Add to Paperback</a>` : ""}
    <div class="url">
      <code id="u">${esc(baseURL)}</code>
      <button onclick="navigator.clipboard&&navigator.clipboard.writeText(document.getElementById('u').textContent).then(()=>{this.textContent='Copied'})">Copy</button>
    </div>
  </div>

  <h2>${sources.length} source${sources.length === 1 ? "" : "s"}</h2>
  <div class="grid">${cards}
  </div>

  <footer>
    Built with Paperback toolchain ${esc(data.builtWith?.toolchain ?? "")}${built ? ` · ${esc(built)}` : ""}
  </footer>
</div>
</body>
</html>
`;

writeFileSync(join(BUNDLES, "index.html"), html);
console.log(`homepage: ${sources.length} source(s), baseURL ${baseURL || "(unset)"}`);
