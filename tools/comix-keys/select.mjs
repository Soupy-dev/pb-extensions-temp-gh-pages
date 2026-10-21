// Chooses which signer-keys file the Pages deploy should publish.
//
//   node select.mjs --published P.json --extracted E.json --out keys/comix-keys.json
//
// A freshly extracted file wins when it is valid and not older than what is already
// published; otherwise the published file is kept (so a failed extraction, for example
// when comix blocks the CI runner, never loses working keys). Writes the chosen file to
// --out and, under GitHub Actions, sets the step output `changed` (true when the chosen
// build differs from the published one, i.e. a redeploy is worthwhile).
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const argv = process.argv.slice(2);
const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);

const read = (file) => {
  try {
    return file ? JSON.parse(readFileSync(file, "utf8")) : null;
  } catch {
    return null;
  }
};
const words = (a) => Array.isArray(a) && a.length === 8 && a.every((n) => Number.isInteger(n) && n >= 0 && n <= 4294967295);
const valid = (k) =>
  !!k && typeof k.build === "string" && /^[A-Za-z0-9]{2,8}\.$/.test(k.prefix ?? "") && words(k.istate) && words(k.ostate) && typeof k.key === "string" && k.key.length >= 64;
const buildNumber = (b) => parseInt(String(b), 36) || 0;

const published = read(arg("--published"));
const extracted = read(arg("--extracted"));

let chosen = null;
if (valid(extracted) && (!valid(published) || buildNumber(extracted.build) >= buildNumber(published.build))) chosen = extracted;
else if (valid(published)) chosen = published;

const out = arg("--out");
if (chosen && out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(chosen, null, 2) + "\n");
}
const changed = !!chosen && (!valid(published) || chosen.build !== published.build);
console.log(
  `published: ${valid(published) ? published.build : "none"}  extracted: ${valid(extracted) ? extracted.build : "none"}  ->  ${chosen ? chosen.build : "nothing to publish"}${changed ? " (changed)" : ""}`,
);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
