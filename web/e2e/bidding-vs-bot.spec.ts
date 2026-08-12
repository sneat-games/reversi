import { test, expect } from "@playwright/test";
import { balanceValue, chooseMenuAndPlay, discCounts, expectBoardFinished, playBiddingVsBotToEnd } from "./helpers";

// Journey 2 (game-kit/docs/DESIGN.md "Testing"): vs Bot bidding -> the
// auction is visible and the first-price TRANSFER conserves the total budget
// -> terminal screen. The budget only decides WHO places; the discs decide
// the match (docs/DESIGN.md §Reversi).

test("bidding vs Bot: commits bids and cells to a terminal banner with budgets conserved", async ({ page }) => {
  test.setTimeout(150_000);

  await page.goto("/");
  await chooseMenuAndPlay(page, { mode: "vs-bot", variant: "bidding" });

  // Both start at the initial budget, and both cards are on screen: the
  // auction economy AND the disc count, because they decide different things.
  await expect.poll(() => balanceValue(page, "p1")).toBe(100);
  await expect.poll(() => balanceValue(page, "p2")).toBe(100);
  await expect.poll(() => discCounts(page)).toEqual([2, 2]);

  // Hints are for the LOCAL player in bidding mode — both sides commit
  // against the same position, so "the side to move" does not exist.
  await expect(page.locator("[data-hint]")).toHaveCount(4);

  // Commit a real (non-zero) bid on the first round.
  await page.locator(".bid-input__number").fill("30");
  await page.locator(".rev-cell--pick").first().click();

  // First-price TRANSFER (game-kit's auction/auction.ts): the winner's bid
  // moves entirely to the loser, so the total (200) is conserved but at
  // least one side's balance must move off 100.
  await expect
    .poll(async () => (await balanceValue(page, "p1")) + (await balanceValue(page, "p2")), { timeout: 10_000 })
    .toBe(200);
  await expect
    .poll(async () => (await balanceValue(page, "p1")) !== 100 || (await balanceValue(page, "p2")) !== 100, {
      timeout: 10_000,
    })
    .toBe(true);

  await playBiddingVsBotToEnd(page, 12);

  const banner = page.locator("[data-match-over]");
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute("data-outcome", /win|loss|draw/);
  await expect(banner.locator(".match-over__balances")).toBeVisible();
  await expect(banner.locator("[data-final-score]")).toBeVisible();

  // Conserved to the last round: the two final balances still sum to 200.
  expect((await balanceValue(page, "p1")) + (await balanceValue(page, "p2"))).toBe(200);

  // And the result came from the DISCS, not the budget.
  const [dark, light] = await discCounts(page);
  const outcome = await banner.getAttribute("data-outcome");
  if (outcome === "win") expect(dark).toBeGreaterThan(light);
  if (outcome === "loss") expect(light).toBeGreaterThan(dark);
  if (outcome === "draw") expect(dark).toBe(light);

  await expectBoardFinished(page);
});
