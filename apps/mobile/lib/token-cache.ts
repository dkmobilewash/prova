import * as SecureStore from "expo-secure-store";
import { clerkPublishableKey } from "./env";

/**
 * Where Clerk's session token lives on the device, and why the key has a
 * prefix.
 *
 * **Namespaced by the publishable key.** Two Clerk instances — the
 * development one and production — hand out tokens that look alike and
 * are not interchangeable. Sharing one SecureStore key between them
 * meant a build could read a token minted by the OTHER instance, which
 * Clerk cannot validate: the app hung with `isLoaded` false rather than
 * starting signed out. Namespacing makes switching instances a
 * sign-out, which is the honest outcome.
 *
 * **The separator is an underscore, deliberately.** SecureStore accepts
 * only alphanumerics, `.`, `-` and `_` in a key; a `:` threw "Invalid
 * key provided to SecureStore" and stalled Clerk init in exactly the way
 * described above — the first version of this fix shipped that bug.
 *
 * The publishable key itself is base64 with its padding stripped, so it
 * could in principle carry `+` or `/`. Checked rather than assumed:
 * 200,000 generated Clerk hostnames produced no such key, because the
 * byte patterns of ASCII hostnames never reach those two symbols. The
 * strip below is therefore belt-and-braces, not a fix for something
 * observed — but it costs nothing and removes the whole class.
 */
export function namespacedKey(publishableKey: string, key: string): string {
  const safe = publishableKey.replace(/[^A-Za-z0-9._-]/g, "");
  // An install with no publishable key cannot reach Clerk at all (see
  // env.ts, which refuses to render), but a cache read must still not
  // produce a key starting with the separator.
  return safe ? `${safe}_${key}` : key;
}

export const tokenCache = {
  async getToken(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(namespacedKey(clerkPublishableKey, key));
    } catch {
      return null;
    }
  },
  async saveToken(key: string, value: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(namespacedKey(clerkPublishableKey, key), value);
    } catch {
      // Best effort. A cache write that fails must never block Clerk
      // init — the token still works for this session, and the next
      // launch signs in again rather than hanging.
    }
  },
};
