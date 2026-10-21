// Extracts comix.to's current request-signing constants and response-cipher key
// from the site's own (obfuscated) "secure" module, so the ComixTo extension can
// follow the site's key rotation without anyone reverse-engineering a new build by hand.
//
// comix rebuilds that module about every 14 hours with a fresh token prefix, fresh
// HMAC-SHA256 midstates and a fresh response XOR key, and retires keys after about one
// generation (a retired key answers 403 key_retired). The module is only ever used as a
// black box here:
//
//   prefix    – read from a token the module produces.
//   ISTATE /  – the module's HMAC-SHA256 midstates. Recovered from a value trace of one
//   OSTATE      signing call: a hook on the VM's stack-value masker records every value,
//               and the SHA-256 round registers visible in that trace determine the
//               midstate (see solveMidstate).
//   key       – the response XOR key. The module's response interceptor is fed one-byte
//               ciphertexts and the plaintext it hands to JSON.parse is read back, which
//               is exactly key[offset] ^ ciphertext byte.
//
// Nothing is published unless every constant reproduces the module's own output for a set
// of probe requests, so a changed build fails loudly instead of shipping bad keys.
//
// The module runs in a headless Chromium page whose origin (https://comix.to) is served
// entirely from request interception: no connection to comix.to is made from the page.
//
// Usage:
//   node extract.mjs [--secure FILE] [--out FILE] [--bundle FILE]
// Without --secure the current module is discovered through comix.to (/ping, the home
// page and the main script). Needs Chrome/Chromium/Edge: set CHROME_PATH or install one.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = "https://comix.to";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";
const argv = process.argv.slice(2);
const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);

// ---------------------------------------------------------------------------
// Discovering the current module

// Plain HTTP first. Cloudflare challenges datacenter addresses (CI runners) with a 403, so on
// a refusal everything is fetched from inside a real browser page that has been through the
// site's check instead; FORCE_BROWSER_FETCH=1 skips straight to that.
let siteFetcher = null;
async function browserFetcher() {
  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-blink-features=AutomationControlled"],
  });
  const page = await browser.newPage();
  await page.setUserAgent(UA.replace("X11; Linux x86_64", "Windows NT 10.0; Win64; x64"));
  await page.goto(`${SITE}/`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  const deadline = Date.now() + 60000;
  for (;;) {
    const title = await page.title().catch(() => "");
    if (title && !/just a moment|checking|verify|attention required/i.test(title)) break;
    if (Date.now() > deadline) {
      await browser.close();
      throw new Error(`the site's browser check did not clear (title: ${title || "none"})`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return {
    async get(url) {
      const r = await page.evaluate(async (u) => {
        const res = await fetch(u);
        return { status: res.status, text: await res.text() };
      }, url);
      if (r.status !== 200) throw new Error(`GET ${url} -> HTTP ${r.status} (in browser)`);
      return r.text;
    },
    close: () => browser.close(),
  };
}

async function getText(url) {
  if (!siteFetcher && process.env.FORCE_BROWSER_FETCH !== "1") {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" } });
    if (res.ok) return res.text();
    if (res.status !== 403 && res.status !== 503) throw new Error(`GET ${url} -> HTTP ${res.status}`);
    console.log(`plain GET ${url} -> HTTP ${res.status}; retrying through a browser`);
  }
  siteFetcher ??= await browserFetcher();
  return siteFetcher.get(url);
}

async function discoverSecure() {
  try {
    const ping = JSON.parse(await getText(`${SITE}/ping?nocache=1`));
    const home = await getText(`${SITE}/`);
    const mainPath = /\/assets\/build\/[A-Za-z0-9_-]+\/dist\/main-[A-Za-z0-9_-]+\.js/.exec(home)?.[0];
    if (!mainPath) throw new Error("main script not found in the home page");
    const main = await getText(SITE + mainPath);
    const secureName = /secure-[A-Za-z0-9_-]+\.js/.exec(main)?.[0];
    if (!secureName) throw new Error("secure module not referenced by the main script");
    const secureUrl = `${SITE}${mainPath.slice(0, mainPath.lastIndexOf("/") + 1)}${secureName}`;
    return { build: ping.buildId, clientVersion: ping.clientVersion, url: secureUrl, source: await getText(secureUrl) };
  } finally {
    await siteFetcher?.close();
  }
}

// ---------------------------------------------------------------------------
// Instrumenting the module: record every value that passes through the VM's
// stack-value masker (raw value, then unmasked value) into globalThis.__T while
// tracing is switched on. The masker has the same shape in every build; only the
// identifiers change.
const MASKER = /([\w$]+)=(void 0!==([\w$]+)\?([\w$]+)=>"number"!=typeof \4\|\|\(0\|\4\)!==\4\|\|Object\.is\(\4,-0\)\?\4:\4\^\3\|0:\4=>\4)/g;

function instrument(source) {
  let hooks = 0;
  const out = source.replace(MASKER, (_m, name, expr, _k, p) => {
    hooks++;
    return `${name}=((__o)=>${p}=>{const __r=__o(${p});if(globalThis.__T)globalThis.__T.push(${p},__r);return __r})(${expr})`;
  });
  if (hooks === 0) throw new Error("stack-value masker not found: the module's layout changed");
  return out;
}

// ---------------------------------------------------------------------------
// SHA-256 helpers and midstate recovery

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;
const S0 = (a) => (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
const S1 = (e) => (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
const Ch = (e, f, g) => ((e & f) ^ (~e & g)) >>> 0;
const Maj = (a, b, c) => ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
const add = (...xs) => xs.reduce((s, x) => (s + x) >>> 0, 0);
const sub = (x, ...ys) => ys.reduce((s, y) => (s - y) >>> 0, x >>> 0);

// Padded message for a hash whose first 64-byte block (the key block) is already consumed.
function padBlocks(msg) {
  const len = (msg.length + 9 + 63) & ~63;
  const buf = new Uint8Array(len);
  buf.set(msg);
  buf[msg.length] = 0x80;
  const bits = (64 + msg.length) * 8;
  for (let i = 0; i < 4; i++) buf[len - 1 - i] = (bits >>> (8 * i)) & 255;
  return buf;
}
function words(buf, off) {
  const w = [];
  for (let i = 0; i < 16; i++) w.push(((buf[off + 4 * i] << 24) | (buf[off + 4 * i + 1] << 16) | (buf[off + 4 * i + 2] << 8) | buf[off + 4 * i + 3]) >>> 0);
  return w;
}
function sha256FromMidstate(state, msg) {
  const h = state.slice();
  const buf = padBlocks(msg);
  for (let off = 0; off < buf.length; off += 64) {
    const w = words(buf, off);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = add(w[i - 16], s0, w[i - 7], s1);
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = add(hh, S1(e), Ch(e, f, g), K[i], w[i]);
      const t2 = add(S0(a), Maj(a, b, c));
      hh = g; g = f; f = e; e = add(d, t1); d = c; c = b; b = a; a = add(t1, t2);
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => (h[i] = add(h[i], v)));
  }
  const out = [];
  for (const v of h) out.push(v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  return out;
}

// In each compression the working variables a and e are rotated every round
// (Σ0: rotr 2/13/22, Σ1: rotr 6/11/25), so their values are visible in the trace next
// to their shifted forms. With a0..a3 and e0..e3 known, the other six round-0 registers
// follow from the round equations (T2 = Σ0(a) + Maj(a,b,c), T1 = h + Σ1(e) + Ch(e,f,g) +
// K + W, a' = T1 + T2, e' = d + T1, and b,c,d / f,g,h are the previous a / e).
function solveMidstate({ a, e }, W) {
  const [a0, a1, a2, a3] = a;
  const [e0, e1, e2, e3] = e;
  const T1_2 = sub(a3, add(S0(a2), Maj(a2, a1, a0)));
  const ms1 = sub(e3, T1_2);
  const ms5 = sub(T1_2, S1(e2), Ch(e2, e1, e0), K[2], W[2]);
  const T1_1 = sub(a2, add(S0(a1), Maj(a1, a0, ms1)));
  const ms2 = sub(e2, T1_1);
  const ms6 = sub(T1_1, S1(e1), Ch(e1, e0, ms5), K[1], W[1]);
  const T1_0 = sub(a1, add(S0(a0), Maj(a0, ms1, ms2)));
  const ms3 = sub(e1, T1_0);
  const ms7 = sub(T1_0, S1(e0), Ch(e0, ms5, ms6), K[0], W[0]);
  return [a0, ms1, ms2, ms3, e0, ms5, ms6, ms7];
}

function recoverMidstates(trace, message) {
  const vals = trace.map((x) => (typeof x === "number" && Number.isInteger(x) ? x >>> 0 : null));
  const rotated = (i0, i1, s) => {
    const out = [];
    for (let i = i0; i < i1; i++) {
      const v = vals[i];
      if (v === null || v < 0x100) continue;
      const win = new Set(vals.slice(i, i + 40));
      if (win.has(v >>> s) && win.has((v << (32 - s)) >>> 0) && !out.some((o) => o.v === v)) out.push({ i, v });
    }
    return out;
  };
  const starts = [];
  vals.forEach((v, i) => {
    if (v === K[0] && (starts.length === 0 || i - starts[starts.length - 1] > 1000)) starts.push(i);
  });
  if (starts.length < 2) throw new Error(`expected two SHA-256 compressions in the trace, found ${starts.length}`);
  const registers = (start) => {
    const from = Math.max(0, start - 400);
    return {
      e: rotated(from, start + 2000, 6).map((x) => x.v).slice(0, 4),
      a: rotated(from, start + 2000, 2).map((x) => x.v).slice(0, 4),
    };
  };
  const msg = Buffer.from(message, "utf8");
  const istate = solveMidstate(registers(starts[0]), words(padBlocks(msg), 0));
  const inner = sha256FromMidstate(istate, msg);
  const ostate = solveMidstate(registers(starts[1]), words(padBlocks(inner), 0));
  return { istate, ostate };
}

const b64url = (bytes) => Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function tokenFor(prefix, istate, ostate, message) {
  const inner = sha256FromMidstate(istate, Buffer.from(message, "utf8"));
  return prefix + b64url(sha256FromMidstate(ostate, inner).slice(0, 12));
}

// ---------------------------------------------------------------------------
// Running the module

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("no Chrome/Chromium/Edge found: set CHROME_PATH");
  return found;
}

// Page-side helpers, installed once the module is imported.
const PAGE_SETUP = async () => {
  const mod = await import("/__keys/secure.js");
  const req = [];
  const res = [];
  mod.r({ interceptors: { request: { use: (f) => req.push(f) }, response: { use: (f) => res.push(f) } }, defaults: { headers: { common: {} } } }, () => {});
  const mkHeaders = () => {
    const h = {};
    return Object.assign(h, { set: (k, v) => ((h[k] = v), h), get: (k) => h[k], has: (k) => k in h });
  };
  window.__k = {
    counts: { request: req.length, response: res.length },
    async sign(url, params, trace) {
      let cfg = { method: "get", url, params: { ...params }, headers: mkHeaders(), baseURL: "/api/v1" };
      if (trace) globalThis.__T = [];
      let traced;
      try {
        for (const f of req) cfg = (await f(cfg)) ?? cfg;
      } finally {
        traced = globalThis.__T;
        globalThis.__T = null;
      }
      return { params: cfg.params, trace: trace ? traced : undefined };
    },
    // Hands the response interceptor a ciphertext and returns what it passed to JSON.parse.
    async decrypt(bytes) {
      let bin = "";
      for (const b of bytes) bin += String.fromCharCode(b);
      let r = { data: { e: btoa(bin) }, headers: { "x-enc": "2" }, status: 200, config: { method: "get", url: "/manga/x", params: {}, headers: mkHeaders() } };
      let error = null;
      try {
        for (const f of res) r = (await f(r)) ?? r;
      } catch (e) {
        error = String(e && e.message);
      }
      return { data: r.data, error };
    },
    // The interceptor decrypts silently and hands back the original payload whenever the
    // plaintext is not valid JSON. A one-byte plaintext is valid JSON only for the digits
    // "0".."9", which come back as the numbers 0..9 – so for key offset m, a ciphertext byte c
    // that returns the number d reveals key[m] = c ^ (0x30 + d). Trying c = (h<<4)|{0,8} for
    // every high nibble h always finds one (the low nibble of c ^ key lands in 0..9 for l = 0 or 8).
    async keyByte(m) {
      const hi = (m >> 8) & 255, lo = m & 255;
      for (let h = 0; h < 16; h++) {
        for (const l of [0, 8]) {
          const c = (h << 4) | l;
          const { data } = await this.decrypt([hi, lo, c]);
          if (typeof data === "number" && Number.isInteger(data) && data >= 0 && data <= 9) return c ^ (0x30 + data);
        }
      }
      return -1;
    },
    async keyStream(from, to) {
      const out = [];
      for (let m = from; m < to; m++) out.push(await this.keyByte(m));
      return out;
    },
  };
  return window.__k.counts;
};

// Smallest period p >= 16 such that the stream repeats with p over at least 200 bytes of overlap.
function periodOf(stream) {
  for (let p = 16; p + 200 <= stream.length; p++) {
    let ok = true;
    for (let i = 0; i + p < stream.length; i++) if (stream[i] !== stream[i + p]) { ok = false; break; }
    if (ok) return p;
  }
  return null;
}

async function withModule(source, fn) {
  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-blink-features=AutomationControlled"],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA.replace("X11; Linux x86_64", "Windows NT 10.0; Win64; x64"));
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      const u = r.url();
      if (u === `${SITE}/__keys/index.html`) r.respond({ status: 200, contentType: "text/html", body: "<!doctype html><html><head><title>keys</title></head><body></body></html>" });
      else if (u === `${SITE}/__keys/secure.js`) r.respond({ status: 200, contentType: "application/javascript; charset=utf-8", body: instrument(source) });
      else r.abort();
    });
    await page.goto(`${SITE}/__keys/index.html`, { waitUntil: "domcontentloaded" });
    const counts = await page.evaluate(PAGE_SETUP);
    if (counts.request < 1 || counts.response < 1) throw new Error(`module installed ${counts.request}/${counts.response} interceptors`);
    return await fn(page);
  } finally {
    await browser.close();
  }
}

// Requests used both to cross-check the extracted constants and to prove the extension
// reproduces the module (path, params as the extension would send them, excluding `_`).
const PROBES = [
  ["/chapters/11523961", {}],
  ["/manga", { "order[chapter_updated_at]": "desc", limit: 15, includes: ["author"] }],
  ["/manga/top", { type: "trending", days: 30, limit: 15, content_rating: "suggestive" }],
  ["/manga/zgk6j", { includes: ["author", "artist"] }],
  ["/manga/zgk6j/chapters", { page: 1, limit: 40, "order[number]": "desc" }],
  ["/manga/zgk6j/chapters", { page: 7, limit: 40, "order[number]": "desc", v: "0" }],
  ["/manga", { "order[relevance]": "desc", page: 2, limit: 20, keyword: "a b&c", genres_in: ["1", "2", "3"], genres_mode: "and", types: ["manhwa"] }],
  ["/manga/mjme", {}],
];

// ---------------------------------------------------------------------------

async function main() {
  const t0 = Date.now();
  const secureFile = arg("--secure");
  const found = secureFile
    ? { build: /secure-([a-z0-9]+)-/.exec(secureFile)?.[1] ?? "local", clientVersion: null, url: secureFile, source: readFileSync(secureFile, "utf8") }
    : await discoverSecure();
  console.log(`module ${found.url} (${found.source.length} bytes, build ${found.build})`);

  const keys = await withModule(found.source, async (page) => {
    // 1. token prefix + HMAC midstates from one traced signing call
    const traceMsg = "/chapters/11523961";
    const traced = await page.evaluate((u) => window.__k.sign(u, {}, true), traceMsg);
    const token = traced.params._;
    if (typeof token !== "string" || !token.includes(".")) throw new Error(`module returned no token: ${JSON.stringify(traced.params)}`);
    const prefix = token.slice(0, token.indexOf(".") + 1);
    console.log(`token ${token}  trace ${traced.trace.length} values`);
    const { istate, ostate } = recoverMidstates(traced.trace, traceMsg);
    if (tokenFor(prefix, istate, ostate, traceMsg) !== token) throw new Error("recovered midstates do not reproduce the traced token");

    // 2. response key from one-byte ciphertexts
    let stream = [];
    let n = null;
    while (!n && stream.length < 12288) {
      const chunk = await page.evaluate((from, to) => window.__k.keyStream(from, to), stream.length, stream.length + 512);
      if (chunk.some((x) => x < 0)) throw new Error(`key probe failed at offset ${stream.length + chunk.findIndex((x) => x < 0)}`);
      stream = stream.concat(chunk);
      n = periodOf(stream);
    }
    if (!n) throw new Error("no key period found within the probe range");
    const key = Buffer.from(stream.slice(0, n));
    console.log(`response key: ${n} bytes (probed ${stream.length} offsets)`);

    // 3. the key must decrypt a ciphertext it did not come from: encrypt a document with it, let the module decrypt it
    const doc = JSON.stringify({ status: "ok", result: { items: [{ id: 1, name: "Ünïcödé \u2603 test" }], meta: { page: 1 } } });
    const pt = Buffer.from(doc, "utf8");
    const off = 12345;
    const ct = [(off >> 8) & 255, off & 255];
    for (let i = 0; i < pt.length; i++) ct.push(pt[i] ^ key[(off % n + i) % n]);
    const back = await page.evaluate((c) => window.__k.decrypt(c).then((r) => r.data), ct);
    if (!back || typeof back !== "object" || !JSON.stringify(back).includes("Ünïcödé")) throw new Error("extracted response key failed the round-trip check");

    return { prefix, istate, ostate, key: key.toString("base64"), keyLength: n };
  });

  // 4. cross-check against the module for every probe, with the extension's own signer
  const bundlePath = resolve(arg("--bundle") ?? join(HERE, "..", "..", "0.8", "ComixTo", "source.js"));
  const ext = loadExtension(bundlePath);
  ext.applySignerKeys({ prefix: keys.prefix, istate: keys.istate, ostate: keys.ostate, key: keys.key });
  await withModule(found.source, async (page) => {
    for (const [path, params] of PROBES) {
      const signed = (await page.evaluate((p, q) => window.__k.sign(p, q, false), path, params)).params;
      const { _: token, ...sent } = signed;
      // axios renders an array-valued param as k[]=a&k[]=b; the extension builds its URLs the same way
      // and encodes values like the extension's search does (spaces as +)
      const enc = (x) => encodeURIComponent(x).replace(/%20/g, "+");
      const query = Object.entries(sent).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => `${k}[]=${enc(x)}`) : [`${k}=${enc(v)}`])).join("&");
      const mine = ext.fastGenerateHash(`https://comix.to/api/v1${path}${query ? "?" + query : ""}`);
      if (mine !== token) throw new Error(`extension signer disagrees with the module for ${path}: ${mine} != ${token}`);
    }
    console.log(`cross-check: extension signer matches the module on ${PROBES.length} request shapes`);
  });

  const result = {
    schema: 1,
    build: found.build,
    clientVersion: found.clientVersion,
    prefix: keys.prefix,
    istate: keys.istate,
    ostate: keys.ostate,
    xEnc: "2",
    key: keys.key,
    extractedAt: new Date().toISOString(),
  };
  const out = arg("--out");
  if (out) writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
  else console.log(JSON.stringify(result, null, 2));
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// Loads the extension bundle in a sandbox and returns its signing internals (same trick the
// test harness uses: splice a hook in just before the IIFE returns).
function loadExtension(bundlePath) {
  const src = readFileSync(bundlePath, "utf8");
  const marker = "return __toCommonJS(ComixTo_exports);";
  if (!src.includes(marker)) throw new Error("bundle layout changed: export marker not found");
  const hook = "globalThis.__comixInternals = { fastGenerateHash, applySignerKeys, canonicalizeQuery };\n  ";
  const sandbox = { App: {}, console, globalThis: null, module: { exports: {} }, exports: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src.replace(marker, hook + marker), sandbox, { filename: "ComixTo/source.js" });
  return sandbox.__comixInternals;
}

export { discoverSecure, instrument, recoverMidstates, tokenFor, sha256FromMidstate, withModule, periodOf, findBrowser, loadExtension, PROBES };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("EXTRACTION FAILED:", e.message);
    process.exit(1);
  });
}
