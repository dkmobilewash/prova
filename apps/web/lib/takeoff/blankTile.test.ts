import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BLANK_TILE_INK } from "./rasterText";

/**
 * ── FIFTEEN MODEL CALLS WERE SPENT ON FIFTEEN BLANK IMAGES ──
 *
 * A browser tester read a real scanned sheet end to end: 15 requests, every
 * one a 200, forty-four seconds, and the answer *"No writing could be made out
 * on this sheet."*
 *
 * The model was right. It was handed blank tiles. The page offset each tile by
 * pre-applying `ctx.translate(...)` and letting `page.render` draw through it
 * — which works in the Node build (the eval reads 101 of 101 printed strings
 * that way) and does not work in the browser. The offset belongs in pdf.js's
 * own `transform` parameter, where it is composed with the viewport transform
 * inside `beginDrawing`; nothing about a canvas's prior state is part of that
 * contract.
 *
 * **The expensive part is not the bug, it is that it cost money to find.**
 * Counting the ink on a tile is free and happens before the request, so a
 * blank picture is never sent, and a sheet whose tiles are ALL blank now says
 * the render failed rather than blaming the drawing — "faint scan" sends
 * somebody hunting for a better copy of a sheet that was fine.
 */

const VIEWER = readFileSync(
  resolve(process.cwd(), "components/TakeoffPlanViewer.tsx"),
  "utf8",
);
const CODE = VIEWER.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const HANDLER = CODE.slice(CODE.indexOf("const onReadSheet"), CODE.indexOf("const onCheckRuns"));

describe("offsetting a tile", () => {
  it("PASSES THE OFFSET TO pdf.js rather than pre-transforming the canvas", () => {
    expect(HANDLER.length, "the scan handler could not be located").toBeGreaterThan(500);
    expect(HANDLER, "the tile render must carry its own transform").toMatch(/transform:\s*\[1,\s*0,\s*0,\s*1,/);
    expect(
      HANDLER,
      "a pre-applied ctx.translate is what produced fifteen blank tiles",
    ).not.toMatch(/ctx\.translate\(/);
  });

  it("still offsets by whole tiles in both directions", () => {
    // The arithmetic itself was never wrong — only where it was applied — so
    // this pins it rather than letting a rewrite quietly change the grid.
    expect(HANDLER).toMatch(/-tx \* TILE_PT \* scale/);
    expect(HANDLER).toMatch(/-ty \* TILE_PT \* scale/);
  });
});

describe("refusing to send a blank tile", () => {
  it("COUNTS THE INK BEFORE SPENDING A CALL", () => {
    const probe = HANDLER.indexOf("getImageData");
    const send = HANDLER.indexOf("readScannedSheetTile(");
    expect(probe, "nothing looks at the tile before it is sent").toBeGreaterThan(-1);
    expect(send, "the tile is no longer sent").toBeGreaterThan(-1);
    expect(probe, "the ink check must come BEFORE the request, or it saves nothing").toBeLessThan(send);
    expect(HANDLER).toMatch(/BLANK_TILE_INK/);
  });

  it("sits an order of magnitude below the emptiest tile that holds words", () => {
    // Measured on the committed fixtures by `tileSkip.eval.ts`: the emptiest
    // WORDED tile carries 0.184% ink. A floor anywhere near that would start
    // skipping tiles with writing on them, which is how a sheet loses the one
    // dimension string its scale depended on.
    expect(BLANK_TILE_INK).toBeLessThan(0.00184 / 5);
    expect(BLANK_TILE_INK).toBeGreaterThan(0);
  });

  it("SAYS THE RENDER FAILED when every tile is blank, rather than blaming the scan", () => {
    // A drawing is never blank everywhere. Reporting that as a faint scan
    // sends somebody to find a better copy of a sheet that was fine.
    const panel = CODE.slice(CODE.indexOf('data-takeoff="read-done"'));
    const upToClose = panel.slice(0, panel.indexOf("</p>"));
    expect(upToClose, "the all-blank case must branch on its own flag").toMatch(/readBlank\s*\?/);
    expect(upToClose).toMatch(/fault on our side/);
    expect(upToClose, "and it must still have the genuinely-faint-scan sentence").toMatch(
      /No writing could be made out/,
    );
  });

  it("only claims the render failed when EVERY tile was blank", () => {
    // One blank tile on a sheet is ordinary — a margin, a corner of paper.
    expect(HANDLER).toMatch(/setReadBlank\(blankTiles === total\)/);
  });
});
