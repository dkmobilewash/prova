export function readPlanPageCount(
  bytes: Uint8Array,
): Promise<{ ok: true; pageCount: number } | { ok: false; reason: string }>;
