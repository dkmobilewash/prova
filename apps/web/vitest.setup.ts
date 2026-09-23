import { installWebStorage } from "./test/memory-storage";

/**
 * Runs before every test file, in that file's own environment.
 *
 * The only job here is Web Storage, and only where a runtime fails to
 * provide it: Node 26's experimental `localStorage` is undefined without
 * `--localstorage-file`, and happy-dom hands that undefined straight
 * through to `window`. See test/memory-storage.ts for why this is
 * conditional rather than unconditional.
 *
 * Node-environment files have no `window` and ask for no storage, so
 * this is a no-op for most of the suite.
 */
if (typeof globalThis !== "undefined") installWebStorage(globalThis);
if (typeof window !== "undefined" && window !== (globalThis as unknown)) installWebStorage(window);
