/**
 * A Content-Disposition value for a file name somebody typed.
 *
 * A header value must be Latin-1. A job named "Tower — Phase 2" put an em dash
 * straight into it, and `new Response` threw "Cannot convert argument to a
 * ByteString", so the G703 download failed with a server error on that job alone.
 * The plain `filename` gets an ASCII stand-in; `filename*` carries the real name,
 * which every current browser prefers.
 */
export function contentDisposition(kind: "attachment" | "inline", fileName: string): string {
  const ascii = fileName.normalize("NFKD").replace(/[\u2013\u2014]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "").trim() || "download";
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName.replace(/[\r\n]/g, ""))}`;
}
