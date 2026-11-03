import { describe, expect, it } from "vitest";
import { contentDisposition } from "./content-disposition";

describe("a downloaded file's name in a header", () => {
  it("can be set on a real response for a name with an em dash, a curly quote and an accent", () => {
    const value = contentDisposition("attachment", "G703 Riverside’s — Café 2.csv");
    expect(() => new Response("x", { headers: { "Content-Disposition": value } })).not.toThrow();
    expect(value).toBe(`attachment; filename="G703 Riverside's - Cafe 2.csv"; filename*=UTF-8''G703%20Riverside%E2%80%99s%20%E2%80%94%20Caf%C3%A9%202.csv`);
  });

  it("cannot be broken out of by a quote or a line break", () => {
    const value = contentDisposition("inline", 'a"b\r\nSet-Cookie: x.pdf');
    expect(value).not.toMatch(/[\r\n]/);
    expect(value.split('filename="')[1].split('"')[0]).toBe("abSet-Cookie: x.pdf");
  });
});
