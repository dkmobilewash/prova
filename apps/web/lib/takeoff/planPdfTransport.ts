/**
 * ── HOW pdf.js FETCHES A PLAN SET ──
 *
 * Every byte of a plan reaches the browser through `/api/takeoff/plan/[planId]`,
 * one function invocation per request, so a request costs latency before it
 * costs bandwidth. pdf.js's defaults are built for a static file on a CDN:
 * open ONE streaming request for the whole file and keep it running in the
 * background ("auto fetch") while range requests pick out the first page. On a
 * 114 MB set that stream is what the estimator waits behind — it shares the
 * line with the dozen small reads the first sheet actually needs.
 *
 * Measured with `scripts/viewer-bench.mts` on Topeka Senior Villas (137 pages,
 * 114 MB), first page drawn, 50 Mbit/s, per-request latency as a function hop:
 *
 *   | transport                          | 250 ms/request | 500 ms/request | bytes before first draw |
 *   | default                            | 6.9 s          | 12.1 s         | 45–77 MB, then the rest |
 *   | disableAutoFetch alone             | 7.0 s          | 12.2 s         | same — the stream stays |
 *   | + disableStream                    | 6.2 s          | 11.5 s         | 8 MB, 22 requests       |
 *   | + disableStream, 1 MB chunks       | 3.8 s          | 6.9 s          | 15 MB, 13 requests      |
 *   | + disableStream, 4 MB chunks       | —              | 6.8 s          | 32 MB, 9 requests       |
 *
 * `disableAutoFetch` on its own changes nothing, because the full-file stream
 * is a separate mechanism; both have to go. 1 MB chunks halve the round trips
 * against the 64 KB default and stop fetching the moment the page is drawn,
 * which is also what keeps the function from streaming 114 MB per sheet open.
 * Numbers in `~/Claude Folder/takeoff/shots/viewer-speed/`, outside git.
 */
export const PLAN_PDF_TRANSPORT = {
  disableAutoFetch: true,
  disableStream: true,
  rangeChunkSize: 1024 * 1024,
} as const;
