import { test, expect } from "@playwright/test";
import {
  chooseMenuAndPlay,
  clickFirstAvailableCell,
  discCounts,
  expectBoardFinished,
  playClassicVsBotToEnd,
} from "./helpers";

// Journey 1 (game-kit/docs/DESIGN.md "Testing"): menu -> vs Bot classic ->
// play a whole 8x8 game to a terminal screen, with the board's own
// affordances (legal-move hints, capture preview) asserted on the way.

test("classic vs Bot: hints and capture preview guide the opening move", async ({ page }) => {
  await page.goto("/");
  await chooseMenuAndPlay(page, { mode: "vs-bot", variant: "classic" });

  // The standard opening offers Dark exactly four legal moves, each hinted.
  await expect(page.locator("[data-hint]")).toHaveCount(4);
  await expect(page.locator(".rev-cell--pick")).toHaveCount(4);

  // d3 is one of them, and it flips exactly one disc — which the cell's
  // accessible name says out loud.
  const d3 = page.locator('[data-cell="19"]'); // row 2, col 3
  await expect(d3).toHaveAttribute("aria-label", "d3 — flips 1 disc");

  // Hovering ghosts the disc AND rings every disc that would flip.
  await d3.hover();
  await expect(page.locator("[data-ghost]")).toBeVisible();
  await expect(page.locator("[data-flip-outline]")).toHaveCount(1);

  await d3.click();

  // 4 dark, 1 light immediately after — the flip actually happened.
  await expect.poll(() => discCounts(page)).toEqual([4, 1]);
});

test("classic vs Bot: plays a full game to a terminal banner", async ({ page }) => {
  test.setTimeout(150_000);

  await page.goto("/");
  await chooseMenuAndPlay(page, { mode: "vs-bot", variant: "classic" });
  await clickFirstAvailableCell(page);

  const { sawPass } = await playClassicVsBotToEnd(page);

  const banner = page.locator("[data-match-over]");
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute("data-outcome", /win|loss|draw/);
  // Reversi's result is a disc count, and the banner always names it.
  await expect(banner.locator("[data-final-score]")).toBeVisible();

  // Every cell is claimed or nobody can move: either way the two counts sum
  // to at most the 64 squares, and the winner has the majority.
  const [dark, light] = await discCounts(page);
  expect(dark + light).toBeGreaterThan(4);
  expect(dark + light).toBeLessThanOrEqual(64);

  const outcome = await banner.getAttribute("data-outcome");
  if (outcome === "win") expect(dark).toBeGreaterThan(light);
  if (outcome === "loss") expect(light).toBeGreaterThan(dark);
  if (outcome === "draw") expect(dark).toBe(light);

  await expectBoardFinished(page);

  // Whether a forced pass comes up depends on how the game goes; when it
  // does, playClassicVsBotToEnd had to work the pass UI to get here. The
  // rule and its banner are pinned deterministically against a constructed
  // position in src/ui/pass-banner.test.ts.
  console.log(`[classic vs bot] forced pass encountered: ${sawPass}`);
});

test("classic vs Bot: rematch starts a fresh board", async ({ page }) => {
  test.setTimeout(150_000);

  await page.goto("/");
  await chooseMenuAndPlay(page, { mode: "vs-bot", variant: "classic" });
  await playClassicVsBotToEnd(page);

  await page.getByRole("button", { name: "Rematch" }).click();
  await expect(page.locator("[data-match-over]")).toHaveCount(0);
  await expect.poll(() => discCounts(page)).toEqual([2, 2]);
  await expect(page.locator("[data-hint]")).toHaveCount(4);
});
