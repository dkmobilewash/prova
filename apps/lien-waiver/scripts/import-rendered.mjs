#!/usr/bin/env node
// Import a page RENDERED by a headless browser (a Firecrawl scrape result,
// saved to disk by the agent harness) into statutes/raw/, for the official
// sites a plain fetch cannot read:
//
//   - statutes.capitol.texas.gov is a JavaScript app: a fetch returns the
//     app's empty shell, and the statute text only exists after it runs;
//   - leginfo.legislature.ca.gov answers 403 to GitHub's runners.
//
// The text still comes from the legislature's own server -- the browser
// rendered it, nobody typed it -- and the result file goes straight from
// disk to disk, so it never passes through an agent's own writing. The
// meta file says which way each capture was made, so the attorney packet
// and the research note can say so too.
//
//   node scripts/import-rendered.mjs <source-id> <firecrawl-result.json>

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [id, resultPath] = process.argv.slice(2);
if (!id || !resultPath) {
  console.error("usage: import-rendered.mjs <source-id> <firecrawl-result.json>");
  process.exit(2);
}
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "statutes");
const { sources } = JSON.parse(await readFile(join(root, "sources.json"), "utf8"));
const source = sources.find((candidate) => candidate.id === id);
if (!source) throw new Error(`${id} is not in sources.json`);

const result = JSON.parse(await readFile(resultPath, "utf8"));
const html = result.rawHtml;
if (typeof html !== "string" || html.length < 500) throw new Error("no rawHtml in that result");
const status = result.metadata?.statusCode;
if (status !== 200) throw new Error(`rendered page answered ${status}`);

const bytes = Buffer.from(html, "utf8");
const sha256 = createHash("sha256").update(bytes).digest("hex");
await writeFile(join(root, "raw", `${id}.html`), bytes);
const meta = {
  id,
  state: source.state,
  citation: source.citation,
  requestedUrl: source.url,
  finalUrl: result.metadata?.url ?? source.url,
  status,
  contentType: "text/html; charset=utf-8 (rendered DOM)",
  capturedVia: "headless-render",
  renderer: "firecrawl",
  rendererScrapeId: result.metadata?.scrapeId ?? null,
  retrievedAt: new Date().toISOString(),
  bytes: bytes.length,
  sha256,
};
await writeFile(join(root, "raw", `${id}.meta.json`), JSON.stringify(meta, null, 2) + "\n");
console.log(`ok   ${id}  ${bytes.length} B  ${sha256.slice(0, 12)}  rendered from ${meta.finalUrl}`);
