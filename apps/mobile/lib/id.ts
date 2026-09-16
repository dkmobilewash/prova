/** A UUID v4-shaped id, good enough for a device id and idempotency keys.
 * Not cryptographically secret — it is not a token, just a collision
 * resistance. */
export function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
