import { describe, expect, it } from "vitest";
import { installWebStorage, MemoryStorage } from "./memory-storage";

/**
 * The double, and the rule that keeps it from lying.
 *
 * A polyfill installed unconditionally would be the worse bug: every
 * storage assertion in this suite would then be a statement about this
 * file rather than about the browser, and it would hide a real
 * happy-dom regression for as long as anybody cared to look.
 */

describe("the in-memory Storage behaves like the real one", () => {
  it("answers null for a key it has never seen, not undefined", () => {
    // Code under test branches on `=== null`; undefined would slip past.
    expect(new MemoryStorage().getItem("nothing")).toBeNull();
  });

  it("stringifies what it is given, the way a browser does", () => {
    const storage = new MemoryStorage();
    storage.setItem("n", 12 as unknown as string);
    expect(storage.getItem("n")).toBe("12");
  });

  it("counts, indexes, removes and clears", () => {
    const storage = new MemoryStorage();
    storage.setItem("a", "1");
    storage.setItem("b", "2");
    expect(storage.length).toBe(2);
    expect(storage.key(0)).toBe("a");
    expect(storage.key(9)).toBeNull();
    storage.removeItem("a");
    expect(storage.getItem("a")).toBeNull();
    expect(storage.length).toBe(1);
    storage.clear();
    expect(storage.length).toBe(0);
  });
});

describe("installing it", () => {
  it("fills in storage a runtime does not provide", () => {
    const target = {} as Record<string, unknown>;
    expect(installWebStorage(target)).toEqual(["localStorage", "sessionStorage"]);
    (target.localStorage as Storage).setItem("k", "v");
    expect((target.localStorage as Storage).getItem("k")).toBe("v");
  });

  it("LEAVES A REAL IMPLEMENTATION ALONE — the whole point", () => {
    const real = new MemoryStorage();
    real.setItem("written-by", "the runtime");
    const target = { localStorage: real, sessionStorage: new MemoryStorage() };

    expect(installWebStorage(target)).toEqual([]);
    expect(target.localStorage).toBe(real);
    expect(target.localStorage.getItem("written-by")).toBe("the runtime");
  });

  it("replaces the undefined-but-present shape Node 26 leaves behind", () => {
    // Not absent, and not usable: `localStorage` is an own property whose
    // value is undefined when Node has no --localstorage-file. That is the
    // exact state that killed five tests on a laptop.
    const target = { localStorage: undefined } as Record<string, unknown>;
    expect(installWebStorage(target)).toContain("localStorage");
    expect((target.localStorage as Storage).getItem("x")).toBeNull();
  });

  it("treats a throwing getter as no storage", () => {
    const target = {};
    Object.defineProperty(target, "localStorage", {
      get() {
        throw new Error("site data blocked");
      },
      configurable: true,
    });
    expect(installWebStorage(target)).toContain("localStorage");
  });
});
