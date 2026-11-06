import { describe, expect, it } from "vitest";
import { resumableUpload, uploadKey, type MultipartCalls, type Part, type SavedUpload } from "./resumableUpload";

/** A 10-byte "file" in 3-byte parts: parts 1–4, the last of 1 byte. */
const file = new Blob(["0123456789"]);
const fake = (failOn: (partNumber: number, attempt: number) => boolean = () => false) => {
  const sent: number[] = [];
  const attempts = new Map<number, number>();
  let created = 0;
  const calls: MultipartCalls = {
    token: async () => "tok",
    create: async () => ((created += 1), { key: "k", uploadId: `u${created}` }),
    part: async (_t, _ids, partNumber, body) => {
      const n = (attempts.get(partNumber) ?? 0) + 1;
      attempts.set(partNumber, n);
      if (failOn(partNumber, n)) throw new Error("connection dropped");
      sent.push(partNumber);
      expect(body.size).toBe(partNumber === 4 ? 1 : 3);
      return { partNumber, etag: `e${partNumber}` };
    },
    complete: async (_t, ids, parts) => ({ url: `https://store/plan.pdf?${ids.uploadId}:${parts.map((p) => p.partNumber).join(",")}` }),
  };
  return { calls, sent, created: () => created };
};

describe("resumableUpload", () => {
  it("uploads every part and completes with them in order, then forgets the saved state", async () => {
    const { calls, sent } = fake();
    const saves: (SavedUpload | null)[] = [];
    const seen: number[] = [];
    const result = await resumableUpload({ file, pathname: "plan.pdf", calls, saved: null, save: (s) => saves.push(s), partBytes: 3, backoffMs: 0, onProgress: (p) => seen.push(p.percent) });
    expect(result.url).toBe("https://store/plan.pdf?u1:1,2,3,4");
    expect(sent.sort()).toEqual([1, 2, 3, 4]);
    expect(saves.at(-1)).toBeNull();
    expect(seen.at(-1)).toBe(100);
  });

  it("A DROPPED PART IS RETRIED ON ITS OWN; the others are not sent again", async () => {
    const { calls, sent } = fake((n, attempt) => n === 2 && attempt < 3);
    await resumableUpload({ file, pathname: "plan.pdf", calls, saved: null, save: () => {}, partBytes: 3, backoffMs: 0 });
    expect(sent.filter((n) => n === 1)).toHaveLength(1);
    expect(sent.filter((n) => n === 2)).toHaveLength(1);
  });

  it("RESUMES: the parts already stored are not sent again, and the same upload is completed", async () => {
    // A first attempt loses its connection for good on part 3.
    const first = fake((n) => n === 3);
    let saved: SavedUpload | null = null;
    await expect(resumableUpload({ file, pathname: "plan.pdf", calls: first.calls, saved: null, save: (s) => (saved = s), partBytes: 3, backoffMs: 0 })).rejects.toThrow("connection dropped");
    const stored = (saved as SavedUpload | null)?.parts.map((p: Part) => p.partNumber).sort() ?? [];
    expect(stored).toContain(1);
    expect(stored).not.toContain(3);
    // Resume (or the same file chosen after a reload): only what is missing goes.
    const second = fake();
    const progress: number[] = [];
    const result = await resumableUpload({ file, pathname: "plan.pdf", calls: second.calls, saved, save: () => {}, partBytes: 3, backoffMs: 0, onProgress: (p) => progress.push(p.percent) });
    expect(second.created()).toBe(0);
    expect(second.sent.sort()).toEqual([1, 2, 3, 4].filter((n) => !stored.includes(n)));
    expect(result.url).toBe("https://store/plan.pdf?u1:1,2,3,4");
    // Progress starts from what was already there, not from zero.
    expect(progress[0]).toBeGreaterThan(0);
  });

  it("an upload saved for another pathname is not resumed into this one", async () => {
    const { calls, created } = fake();
    const other: SavedUpload = { pathname: "other.pdf", ids: { key: "k", uploadId: "old" }, parts: [{ partNumber: 1, etag: "x" }] };
    const result = await resumableUpload({ file, pathname: "plan.pdf", calls, saved: other, save: () => {}, partBytes: 3, backoffMs: 0 });
    expect(created()).toBe(1);
    expect(result.url).toBe("https://store/plan.pdf?u1:1,2,3,4");
  });

  it("the same file chosen again finds its upload; a different one does not", () => {
    const a = { name: "ELEVEN03.pdf", size: 342_447_290, lastModified: 1 };
    expect(uploadKey("job_1", a)).toBe(uploadKey("job_1", { ...a }));
    expect(uploadKey("job_1", a)).not.toBe(uploadKey("job_1", { ...a, size: 1 }));
    expect(uploadKey("job_1", a)).not.toBe(uploadKey("job_2", a));
  });
});
