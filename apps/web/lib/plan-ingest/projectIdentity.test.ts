import { describe, expect, it } from "vitest";
import { labelledIdentity, projectTags, uploadProjects } from "./projectIdentity";

// Every Minnesota-sealed sheet prints its licence certification, whoever's project it is (measured on Aldrich: the
// first reader joined Excell to Kurita through these lines).
const CERTIFY = ["I HEREBY CERTIFY THAT THIS PLAN, SPECIFICATION OR REPORT", "WAS PREPARED BY ME OR UNDER MY DIRECT SUPERVISION", "LAWS OF THE STATE OF MINNESOTA"];
// Title-block text as the inventory stores it (`titleBlockText`): one line per baseline, top down.
const excell = (sheet: string) =>
  ["U+B ARCHITECTURE & DESIGN, INC.", "2609 ALDRICH AVENUE SOUTH SUITE 100", "MINNEAPOLIS, MINNESOTA 55408", "Excell Academy for Higher Learning", "6510 Zane Ave. N.", "Brooklyn Park, MN 55429", "Project: 2019015_EXC-6", "DESIGN DEVELOPMENT DRAWINGS", "NOT FOR CONSTRUCTION", ...CERTIFY, sheet].join("\n");
const kurita = (sheet: string) =>
  ["RYAN A+E, INC.", "533 SOUTH THIRD STREET, SUITE 100", "PROJECT INFORMATION", "KURITA", "6600 94th Ave N", "Brooklyn Park, MN", "CITY RESUBMITTAL SET", "NOT FOR CONSTRUCTION", "PROJECT NO. 905-586", ...CERTIFY, sheet].join("\n");

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
    expect(got.groups.map((g) => g.number)).toEqual(["2019015_EXC-6", "905-586"]);
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

  it("a sheet with no printed number joins the template it shares the most lines with, not the first boilerplate match", () => {
    const a = ["PROJECT NO. 1001", "NOT FOR CONSTRUCTION", ...CERTIFY.slice(1)].join("\n");
    const tpl = ["RYAN A+E, INC.", "533 SOUTH THIRD STREET, SUITE 100", "CITY RESUBMITTAL SET", "BROOKLYN PARK, MINNESOTA"];
    const got = uploadProjects([
      { pageNumber: 1, titleBlockText: a, counted: true },
      { pageNumber: 2, titleBlockText: [...tpl, ...CERTIFY.slice(1), "C100"].join("\n"), counted: false },
      { pageNumber: 3, titleBlockText: [...tpl, "PROJECT NO. 2002", "A101"].join("\n"), counted: true },
      { pageNumber: 4, titleBlockText: [...tpl, "PROJECT NO. 2002", "A102"].join("\n"), counted: true },
    ]);
    expect(got.groups.map((g) => g.pages)).toEqual([[1], [2, 3, 4]]);
  });

  it("a table header under a project-number label is not a number", () => {
    expect(labelledIdentity("PROJECT NO. DATE\nA101").number).toBeNull();
    expect(labelledIdentity("PROJECT NO. 905-586\nA101").number).toBe("905-586");
  });
});

describe("projectTags: which sheets stand aside (TAKEOFF_PROJECT_IDENTITY)", () => {
  const aldrich = [
    { pageNumber: 18, titleBlockText: excell("A001"), counted: true },
    { pageNumber: 26, titleBlockText: excell("A111"), counted: false },
    { pageNumber: 40, titleBlockText: "PLANNING COMMISSION REPORT\nPAGE 3", counted: false },
    { pageNumber: 66, titleBlockText: kurita("A101"), counted: true },
    { pageNumber: 67, titleBlockText: kurita("A102"), counted: true },
  ];

  it("before anyone chooses, every sheet waits and the question offers each counted project, no default", () => {
    const got = projectTags(aldrich, []);
    expect([...got.tags.values()].every((t) => t === "unasked")).toBe(true);
    expect([...got.tags.keys()]).toEqual([18, 26, 40, 66, 67]);
    expect(got.question?.groups.map((g) => g.label)).toEqual(["Project 2019015_EXC-6", "KURITA"]);
    expect(got.question?.chosen).toBeNull();
  });

  it("after the choice, only the chosen project's sheets are candidates; everything else is another project", () => {
    const got = projectTags(aldrich, [18, 26]);
    expect(Object.fromEntries(got.tags)).toEqual({ 40: "other project", 66: "other project", 67: "other project" });
    expect(got.question?.chosen).toBe(0);
  });

  it("a one-project upload tags nothing and asks nothing, whatever was stored", () => {
    const one = aldrich.filter((p) => p.pageNumber < 60);
    expect(projectTags(one, []).tags.size).toBe(0);
    expect(projectTags(one, []).question).toBeNull();
    expect(projectTags(one, [18]).tags.size).toBe(0);
  });

  it("a stored choice that no longer matches any counted project asks again", () => {
    const got = projectTags(aldrich, [999]);
    expect(got.question?.chosen).toBeNull();
    expect([...got.tags.values()].every((t) => t === "unasked")).toBe(true);
  });
});
