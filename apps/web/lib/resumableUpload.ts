/**
 * ── A BIG PLAN SET, UPLOADED IN PARTS, THAT PICKS UP WHERE IT STOPPED ──
 *
 * Diego, 2026-11-06: big plan sets go straight to storage, with progress, and a
 * slow or dropped connection must not lose the upload. One `put` of a 200 MB
 * file over a hotel connection is one request that fails as a whole.
 *
 * So the file goes as a multipart upload (Vercel Blob's own: parts of at least
 * 5 MB, then one "complete"), a few parts at a time, each retried on its own.
 * Which parts are done is saved under the file's identity (name, size, last
 * modified, and the record it is for), so pressing Resume, or choosing the same
 * file again after a reload, uploads only the parts that are missing.
 *
 * The Blob calls are passed in (`MultipartCalls`), so this is the orchestration
 * only, and it is what the unit test drives; `lib/document-upload-client.ts`
 * wires the real ones.
 */

export const PART_BYTES = 8 * 1024 * 1024;
const CONCURRENCY = 3;
const TRIES = 4;

export type Part = { partNumber: number; etag: string };
export type UploadIds = { key: string; uploadId: string };
/** What survives a dropped connection or a reload: the upload and the parts already stored. */
export type SavedUpload = { pathname: string; ids: UploadIds; parts: Part[] };

export type MultipartCalls = {
  /** A fresh token for the pathname (they expire; one is asked for per attempt). */
  token: () => Promise<string>;
  create: (token: string) => Promise<UploadIds>;
  part: (token: string, ids: UploadIds, partNumber: number, body: Blob) => Promise<Part>;
  complete: (token: string, ids: UploadIds, parts: Part[]) => Promise<{ url: string }>;
};

export type Progress = { loaded: number; total: number; percent: number };

/** The key a file's upload is saved under: the same file chosen again finds it. */
export function uploadKey(ownerId: string, file: { name: string; size: number; lastModified: number }): string {
  return `plan-upload:${ownerId}:${file.size}:${file.lastModified}:${file.name}`;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function resumableUpload(input: {
  file: Blob;
  pathname: string;
  calls: MultipartCalls;
  saved: SavedUpload | null;
  save: (state: SavedUpload | null) => void;
  onProgress?: (progress: Progress) => void;
  signal?: AbortSignal;
  partBytes?: number;
  backoffMs?: number;
}): Promise<{ url: string }> {
  const partBytes = input.partBytes ?? PART_BYTES;
  const backoffMs = input.backoffMs ?? 1_000;
  const total = input.file.size;
  const count = Math.max(1, Math.ceil(total / partBytes));
  const sizeOf = (n: number) => Math.min(partBytes, total - (n - 1) * partBytes);

  let token = await input.calls.token();
  // An upload saved for another pathname is not this one: start over.
  const resumed = input.saved !== null && input.saved.pathname === input.pathname ? input.saved : null;
  const ids = resumed?.ids ?? (await input.calls.create(token));
  const done = new Map<number, Part>((resumed?.parts ?? []).filter((p) => p.partNumber >= 1 && p.partNumber <= count).map((p) => [p.partNumber, p]));
  const persist = () => input.save({ pathname: input.pathname, ids, parts: [...done.values()].sort((a, b) => a.partNumber - b.partNumber) });
  persist();

  let loaded = [...done.keys()].reduce((n, k) => n + sizeOf(k), 0);
  const report = () => input.onProgress?.({ loaded, total, percent: total === 0 ? 100 : Math.floor((loaded / total) * 100) });
  report();

  const todo = Array.from({ length: count }, (_, i) => i + 1).filter((n) => !done.has(n));
  async function one(partNumber: number): Promise<void> {
    const body = input.file.slice((partNumber - 1) * partBytes, (partNumber - 1) * partBytes + sizeOf(partNumber));
    for (let attempt = 1; ; attempt += 1) {
      if (input.signal?.aborted) throw new Error("The upload was stopped.");
      try {
        const part = await input.calls.part(token, ids, partNumber, body);
        done.set(partNumber, part);
        loaded += sizeOf(partNumber);
        persist();
        report();
        return;
      } catch (error) {
        if (attempt >= TRIES) throw error;
        await wait(backoffMs * attempt);
        // A token can run out on a slow connection: ask again before retrying.
        token = await input.calls.token().catch(() => token);
      }
    }
  }
  // A few at a time: enough to fill a connection, not so many a slow one chokes.
  // A worker that gives up stops taking parts; the others finish theirs before
  // the failure is reported, so what is saved is everything that got through
  // and Resume sends nothing twice.
  let next = 0;
  let failure: unknown = null;
  await Promise.allSettled(
    Array.from({ length: Math.min(CONCURRENCY, todo.length) }, async () => {
      while (failure === null && next < todo.length) {
        try {
          await one(todo[next++]!);
        } catch (error) {
          failure ??= error;
        }
      }
    }),
  );
  if (failure !== null) throw failure;

  const result = await input.calls.complete(token, ids, [...done.values()].sort((a, b) => a.partNumber - b.partNumber));
  input.save(null);
  return result;
}
