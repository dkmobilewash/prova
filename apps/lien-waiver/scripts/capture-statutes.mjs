#!/usr/bin/env node
// Fetch every official statute page in statutes/sources.json and write the
// bytes the server sent, UNTOUCHED, to statutes/raw/.
//
// This is the only way statutory text enters this app. Nobody types it, and
// no model transcribes it: the text a sub signs has to be traceable, byte for
// byte, to a legislature's own server, and the SHA-256 written here is that
// trace. Everything downstream (scripts/extract-forms.mjs, the form data, the
// PDF) is derived from these files and tested back against them.
//
// Runs where the legislature hosts are reachable. An agent container's egress
// proxy refuses them, so in practice this runs in the `Capture statutes`
// workflow, which commits the result back to the branch.
//
//   node apps/lien-waiver/scripts/capture-statutes.mjs [id ...]
//
// A failed fetch is reported and exits non-zero, and NEVER overwrites a good
// capture with an error page.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "statutes");
const { sources } = JSON.parse(await readFile(join(root, "sources.json"), "utf8"));
const only = new Set(process.argv.slice(2));
const rawDir = join(root, "raw");
await mkdir(rawDir, { recursive: true });

let failed = 0;
for (const source of sources) {
  if (only.size && !only.has(source.id)) continue;
  if (source.capture === "headless-render") {
    // A plain fetch of these gets an empty app shell (TX) or a 403 (CA), and
    // writing that over a good capture is the one thing this script must
    // never do. They come in through scripts/import-rendered.mjs.
    console.log(`skip ${source.id}  rendered source: ${source.why}`);
    continue;
  }
  try {
    const response = await fetch(source.url, {
      redirect: "follow",
      // A plain browser user-agent: leginfo.legislature.ca.gov answers 403 to
      // anything that announces itself as a script.
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (bytes.length < 500) throw new Error(`only ${bytes.length} bytes`);
    const contentType = response.headers.get("content-type") ?? "";
    const extension = contentType.includes("pdf") ? "pdf" : contentType.includes("javascript") ? "js" : "html";
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const previous = await readFile(join(rawDir, `${source.id}.meta.json`), "utf8")
      .then((text) => JSON.parse(text))
      .catch(() => null);
    if (previous?.sha256 === sha256) {
      // Same bytes as the capture on file: keep its retrieval date, which
      // is the date the form data and the attorney review were made against.
      console.log(`same ${source.id}  ${sha256.slice(0, 12)}`);
      continue;
    }
    await writeFile(join(rawDir, `${source.id}.${extension}`), bytes);
    const meta = {
      id: source.id,
      state: source.state,
      citation: source.citation,
      requestedUrl: source.url,
      finalUrl: response.url,
      status: response.status,
      contentType,
      retrievedAt: new Date().toISOString(),
      bytes: bytes.length,
      sha256,
    };
    await writeFile(join(rawDir, `${source.id}.meta.json`), JSON.stringify(meta, null, 2) + "\n");
    console.log(`ok   ${source.id}  ${bytes.length} B  ${sha256.slice(0, 12)}  ${response.url}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${source.id}  ${source.url}  ${error instanceof Error ? error.message : error}`);
  }
}
if (failed) {
  console.log(`${failed} source(s) failed; existing captures for them were left as they were.`);
  process.exitCode = 1;
}
