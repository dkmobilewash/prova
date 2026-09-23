/**
 * Web Storage for tests, and the reason it exists is a Node version.
 *
 * Node 26 ships its own experimental `localStorage`, and without the
 * `--localstorage-file` flag that global is UNDEFINED rather than
 * absent. happy-dom's window picks it up, so `window.localStorage` is
 * an own property whose value is undefined — which is not a shape any
 * code guards for. Five tests in `sentDateDefault.test.ts` died on
 * `window.localStorage.clear()` on a laptop while CI, pinned to Node 20,
 * stayed green. A suite that passes only on the CI runner's Node is a
 * suite that stops being run locally.
 *
 * So the setup file installs this when — and only when — the runtime
 * gives no usable Storage. It is deliberately NOT unconditional: on
 * Node 20 the real happy-dom implementation is what the app meets in a
 * browser, and a test double that quietly replaced it would make every
 * storage assertion a statement about this file instead.
 */

export class MemoryStorage implements Storage {
  private entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getItem(key: string): string | null {
    // Storage returns null for a missing key, never undefined — code
    // under test branches on that difference.
    return this.entries.has(String(key)) ? (this.entries.get(String(key)) as string) : null;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.entries.delete(String(key));
  }

  setItem(key: string, value: string): void {
    // Everything stored is a string, including the numbers and nulls a
    // draft happens to hold — the browser stringifies, so this must too,
    // or a test passes on a value the real thing would never return.
    this.entries.set(String(key), String(value));
  }
}

/** Whether a target already has storage that can actually be used. */
function hasUsableStorage(target: object, name: "localStorage" | "sessionStorage"): boolean {
  try {
    const existing = (target as Record<string, unknown>)[name];
    return Boolean(existing) && typeof (existing as Storage).getItem === "function";
  } catch {
    // A getter that throws (a private window, blocked site data, Node's
    // own flag-less global) counts as no storage at all.
    return false;
  }
}

/**
 * Give `target` working `localStorage`/`sessionStorage` if it has none.
 *
 * Returns the names it had to install, so the setup file can be silent
 * on a runtime that needs nothing and a test can assert the rule.
 */
export function installWebStorage(target: object): ("localStorage" | "sessionStorage")[] {
  const installed: ("localStorage" | "sessionStorage")[] = [];
  for (const name of ["localStorage", "sessionStorage"] as const) {
    if (hasUsableStorage(target, name)) continue;
    Object.defineProperty(target, name, {
      value: new MemoryStorage(),
      configurable: true,
      writable: true,
    });
    installed.push(name);
  }
  return installed;
}
