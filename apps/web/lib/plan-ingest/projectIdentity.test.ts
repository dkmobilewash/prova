import { describe, expect, it } from "vitest";
import { uploadProjects } from "./projectIdentity";

// Title-block text as the inventory stores it (`titleBlockText`): one line per baseline, top down.
const excell = (sheet: string) =>
  ["U+B ARCHITECTURE & DESIGN, INC.", "2609 ALDRICH AVENUE SOUTH SUITE 100", "MINNEAPOLIS, MINNESOTA 55408", "Excell Academy for Higher Learning", "6510 Zane Ave. N.", "Brooklyn Park, MN 55429", "Project: 2019015_EXC-6", "DESIGN DEVELOPMENT DRAWINGS", "NOT FOR CONSTRUCTION", sheet].join("\n");
const kurita = (sheet: string) =>
  ["RYAN A+E, INC.", "533 SOUTH THIRD STREET, SUITE 100", "PROJECT INFORMATION", "KURITA", "6600 94th Ave N", "Brooklyn Park, MN", "CITY RESUBMITTAL SET", "NOT FOR CONSTRUCTION", sheet].join("\n");

describe("uploadProjects: an upload that holds more than one project (prereg-project-identity.md)", () => {
  it("Aldrich: Excell Academy and Kurita are two projects, each owning a counted sheet, so it asks", () => {
    const got = uploadProjects([
      { pageNumber: 18, titleBlockText: excell("A001"), counted: true },
      { pageNumber: 26, titleBlockText: excell("A111"), counted: false },
      { pageNumber: 27, titleBlockText: excell("A300"), counted: false },
      { pageNumber: 66, titleBlockText: kurita("A101"), counted: true },
      { pageNumber: 67, titleBlockText: kurita("A102"), counted: true },
    ]);
    expect(got.asks).toBe(true);
    expect(got.groups.map((g) => g.pages)).toEqual([[18, 26, 27], [66, 67]]);
    // Excell labels only its number ("Project: 2019015_EXC-6"); Kurita labels its name under PROJECT INFORMATION.
    expect(got.groups.map((g) => g.label)).toEqual(["Project 2019015_EXC-6", "KURITA"]);
    // What the question shows beside the label: each group's own repeated title-block lines.
    expect(got.groups[0]!.lines).toContain("Excell Academy for Higher Learning");
  });

  it("one project with an addendum's re-issued sheets and a consultant's own title block does NOT ask", () => {
    const arch = (sheet: string, addendum = false) =>
      ["SMITH ARCHITECTS", "100 MAIN STREET, SPRINGFIELD", "K-4 SCHOOL ADDITION", "PROJECT NO: 15-025", ...(addendum ? ["ADDENDUM #2 - 03/14/2016"] : []), sheet].join("\n");
    const civil = (sheet: string) => ["ZERR BERG ENGINEERS", "CIVIL ENGINEERING", "K-4 SCHOOL ADDITION", "JOB NO. 2231", sheet].join("\n");
    const got = uploadProjects([
      { pageNumber: 3, titleBlockText: arch("A101"), counted: true },
      { pageNumber: 4, titleBlockText: arch("A102", true), counted: true },
      { pageNumber: 5, titleBlockText: arch("A201"), counted: false },
      { pageNumber: 23, titleBlockText: civil("C101"), counted: false },
      { pageNumber: 24, titleBlockText: civil("C102"), counted: false },
    ]);
    expect(got.asks).toBe(false);
  });

  it("an addendum sheet in another template is the same project when it carries the same project number", () => {
    const arch = (sheet: string) => ["SMITH ARCHITECTS", "100 MAIN STREET, SPRINGFIELD", "K-4 SCHOOL ADDITION", "PROJECT NO: 15-025", sheet].join("\n");
    const addendum = (sheet: string) => ["ADDENDUM NO. 2", "ISSUED FOR BID 03/14/2016", "PROJECT #: 15-025", sheet].join("\n");
    const got = uploadProjects([
      { pageNumber: 1, titleBlockText: arch("A101"), counted: true },
      { pageNumber: 2, titleBlockText: arch("A102"), counted: false },
      { pageNumber: 3, titleBlockText: addendum("A101.1"), counted: true },
      { pageNumber: 4, titleBlockText: addendum("A102.1"), counted: false },
    ]);
    expect(got.asks).toBe(false);
  });

  it("sheets that abbreviate the project's name are still one project", () => {
    const full = (sheet: string) => ["U+B ARCHITECTURE & DESIGN, INC.", "MINNEAPOLIS, MINNESOTA 55408", "PROJECT NAME: EXCELL ACADEMY FOR HIGHER LEARNING", sheet].join("\n");
    const short = (sheet: string) => ["U+B ARCHITECTURE & DESIGN", "PROJECT NAME: EXCELL ACADEMY", sheet].join("\n");
    const got = uploadProjects([
      { pageNumber: 1, titleBlockText: full("A101"), counted: true },
      { pageNumber: 2, titleBlockText: full("A102"), counted: false },
      { pageNumber: 3, titleBlockText: short("A201"), counted: true },
      { pageNumber: 4, titleBlockText: short("A202"), counted: false },
    ]);
    expect(got.asks).toBe(false);
    expect(got.groups).toHaveLength(1);
  });

  it("a page with no title-block text, or one alone in its template, never forms a project of its own", () => {
    const got = uploadProjects([
      { pageNumber: 1, titleBlockText: excell("A101"), counted: true },
      { pageNumber: 2, titleBlockText: excell("A102"), counted: true },
      { pageNumber: 3, titleBlockText: null, counted: true },
      { pageNumber: 4, titleBlockText: "SOME ONE-OFF COVER PAGE\nINDEX OF DRAWINGS", counted: true },
    ]);
    expect(got.asks).toBe(false);
  });
});
