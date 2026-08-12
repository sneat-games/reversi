import { type Page, expect } from "@playwright/test";

export interface MenuChoice {
  mode?: "vs-bot" | "vs-friend";
  variant?: "classic" | "bidding";
}

/** Drive game-kit's renderMenu radio groups (see src/ui/menu.ts) and submit.
 *  Reversi has a single board size, so there is nothing to pick there. */
export async function chooseMenuAndPlay(page: Page, choice: MenuChoice): Promise<void> {
  if (choice.mode) await page.locator(`label[for="mode-${choice.mode}"]`).click();
  if (choice.variant) await page.locator(`label[for="variant-${choice.variant}"]`).click();
  await page.locator(".menu__play").click();
}

/** Click the first pickable (legal, interactive) board cell, if any. Returns
 *  whether a cell was found and clicked. */
export async function clickFirstAvailableCell(page: Page): Promise<boolean> {
  const cell = page.locator(".rev-cell--pick").first();
  if ((await cell.count()) === 0) return false;
  await cell.click({ timeout: 5_000 }).catch(() => {});
  return true;
}

/**
 * Acknowledge a forced pass if one is on screen. Returns whether it was.
 *
 * This is not optional politeness: while the pass banner is up its button is
 * the ONLY enabled control (see src/ui/pass-banner.ts), so a match that
 * reaches a pass cannot continue until it is clicked. Whether a pass happens
 * at all depends on how the game goes, which is why the rule and its UI are
 * also pinned deterministically in src/ui/pass-banner.test.ts against a
 * constructed position.
 */
export async function passIfAsked(page: Page): Promise<boolean> {
  const button = page.locator("[data-pass-button]");
  if ((await button.count()) === 0) return false;
  await button.click({ timeout: 5_000 }).catch(() => {});
  return true;
}

export interface PlayToEndResult {
  /** Whether a forced pass came up during the match. */
  sawPass: boolean;
}

/** Play a CLASSIC vs-Bot match to its terminal banner by always taking the
 *  first legal cell (and passing when the board leaves no choice). */
export async function playClassicVsBotToEnd(page: Page, maxSteps = 400): Promise<PlayToEndResult> {
  let sawPass = false;
  for (let i = 0; i < maxSteps; i++) {
    if ((await page.locator("[data-match-over]").count()) > 0) return { sawPass };
    if (await passIfAsked(page)) {
      sawPass = true;
      continue;
    }
    await clickFirstAvailableCell(page);
    await page.waitForTimeout(120);
  }
  throw new Error("classic vs-bot match did not reach a terminal banner in time");
}

/** Play a BIDDING vs-Bot match to its terminal banner: commit a fixed bid
 *  when a bid is being asked for, then take the first legal cell. Rounds
 *  where only one side can move take no bid at all — the bid input is
 *  disabled for those, which `isEditable` handles. */
export async function playBiddingVsBotToEnd(page: Page, bid: number, maxSteps = 400): Promise<void> {
  for (let i = 0; i < maxSteps; i++) {
    if ((await page.locator("[data-match-over]").count()) > 0) return;
    const bidInput = page.locator(".bid-input__number");
    if ((await bidInput.count()) > 0 && (await bidInput.isEditable())) {
      await bidInput.fill(String(bid)).catch(() => {});
    }
    await clickFirstAvailableCell(page);
    await page.waitForTimeout(120);
  }
  throw new Error("bidding vs-bot match did not reach a terminal banner in time");
}

/** The two disc counts from the score card, `[dark, light]`. */
export async function discCounts(page: Page): Promise<[number, number]> {
  const values = await page.locator("[data-disc-score-card] .score-card__value").allInnerTexts();
  return [Number(values[0]), Number(values[1])];
}

/** Parse a balances row's "Label: value/max" text into its numeric value. */
export async function balanceValue(page: Page, player: "p1" | "p2"): Promise<number> {
  const text = await page.locator(`[data-balance="${player}"] .balances__label`).innerText();
  const match = /:\s*(-?\d+)\/(\d+)/.exec(text);
  if (!match) throw new Error(`could not parse balance text: "${text}"`);
  return Number(match[1]);
}

/** Assert the finished board did its end-of-match treatment: dimmed, swept,
 *  and no longer offering moves. */
export async function expectBoardFinished(page: Page): Promise<void> {
  await expect(page.locator("[data-board]")).toHaveClass(/rev-board--over/);
  await expect(page.locator("[data-sweep]")).toBeAttached();
  await expect(page.locator(".rev-cell--pick")).toHaveCount(0);
}
