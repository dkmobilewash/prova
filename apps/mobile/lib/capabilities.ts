import type { Capability, Me } from "./types";

/**
 * Whether this person holds a capability.
 *
 * `null` — nothing loaded yet, and no cache to fall back on — answers
 * TRUE. The alternative is a phone that has never been online hiding the
 * whole app from a foreman standing in a basement, which is a worse
 * failure than showing a screen the server will refuse: the refusal is
 * one honest sentence, the empty shell is a dead phone.
 */
export function holds(me: Me | null, capability: Capability): boolean {
  if (!me) return true;
  return me.capabilities.includes(capability);
}
