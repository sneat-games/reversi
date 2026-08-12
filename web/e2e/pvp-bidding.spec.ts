import { test, expect, type Page } from "@playwright/test";
import { balanceValue, chooseMenuAndPlay } from "./helpers";

// The bidding variant across two browsers: every contested round is a
// commit/reveal exchange over the DataChannel (both bid AND cell hidden
// until reveal), and every one-sided round skips the auction entirely. This
// is the most intricate path in the app, so it gets its own journey on top
// of the four the DESIGN.md testing plan requires.

test("PvP bidding: hidden auctions run to a terminal banner with budgets conserved on both sides", async ({
  browser,
}) => {
  test.setTimeout(180_000);

  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  try {
    await host.goto("/");
    await chooseMenuAndPlay(host, { mode: "vs-friend", variant: "bidding" });
    const shareLink = (await host.locator("[data-invite-link]").innerText({ timeout: 15_000 })).trim();
    const url = new URL(shareLink);
    await guest.goto(`${url.pathname}${url.search}${url.hash}`);

    // Both sides land on the bidding screen: the auction economy AND the
    // disc count, since they decide different things.
    await expect(host.locator("[data-balances]")).toBeVisible({ timeout: 40_000 });
    await expect(guest.locator("[data-balances]")).toBeVisible({ timeout: 40_000 });
    await expect(host.locator("[data-disc-score-card]")).toBeVisible();

    // Both sides may act at once — there is no "side to move" in bidding.
    await expect(host.locator(".rev-cell--pick")).toHaveCount(4, { timeout: 15_000 });
    await expect(guest.locator(".rev-cell--pick")).toHaveCount(4);

    await commitRound(host, 25);
    await commitRound(guest, 10);

    // First-price TRANSFER: the total is conserved, and the host (who bid
    // more) has paid it across to the guest.
    await expect.poll(async () => await balanceValue(host, "p1"), { timeout: 15_000 }).toBe(75);
    await expect.poll(async () => await balanceValue(host, "p2")).toBe(125);
    // Both clients agree on the post-round budgets. Each peer resolves the
    // round on its own clock (the reveal has to cross the DataChannel), so
    // this polls rather than reading once — a lagging peer is normal, a
    // peer that never agrees is the bug worth catching.
    await expect.poll(async () => await balanceValue(guest, "p1"), { timeout: 15_000 }).toBe(75);
    await expect.poll(async () => await balanceValue(guest, "p2")).toBe(125);

    const rounds = await playUntilOver(host, guest);

    const hostOver = host.locator("[data-match-over]");
    const guestOver = guest.locator("[data-match-over]");
    await expect(hostOver).toBeVisible();
    await expect(guestOver).toBeVisible();
    expect([["draw", "draw"], ["loss", "win"]]).toContainEqual(
      [await hostOver.getAttribute("data-outcome"), await guestOver.getAttribute("data-outcome")].sort(),
    );

    // Conserved to the last round, on both clients.
    expect((await balanceValue(host, "p1")) + (await balanceValue(host, "p2"))).toBe(200);
    expect((await balanceValue(guest, "p1")) + (await balanceValue(guest, "p2"))).toBe(200);

    // Both clients show the same final position. A bidding match can end
    // very early by ANNIHILATION — one side winning two auctions in a row
    // can wipe the other's colour off the board, and with no discs of one
    // colour left neither player has a legal move — so the round count is
    // logged rather than asserted.
    const finalScore = await hostOver.locator("[data-final-score]").getAttribute("data-final-score");
    expect(finalScore).toBe(await guestOver.locator("[data-final-score]").getAttribute("data-final-score"));
    console.log(`[pvp bidding] rounds driven after the scripted one: ${rounds}, final discs ${finalScore}`);
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});

/**
 * The same breadth-first-search opening the classic PvP spec uses (d3 c3 b3
 * b2 f5 a3 a1 c1): after those eight discs, DARK has no legal move while
 * LIGHT does. In BIDDING mode the auction winner plays, and the higher bid
 * always wins — so bidding 2 against 1 lets this spec choose the mover for
 * every round and reproduce that position exactly. What follows is the rule
 * this whole variant turns on: with only one side able to move, NO auction
 * runs and nothing is paid (game-kit/docs/DESIGN.md §Reversi).
 */
const FORCED_ONE_SIDED_OPENING = [19, 18, 17, 9, 37, 16, 0, 2];

test("PvP bidding: when only one side can move, they move free — no auction, nothing paid", async ({ browser }) => {
  test.setTimeout(180_000);

  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  try {
    await host.goto("/");
    await chooseMenuAndPlay(host, { mode: "vs-friend", variant: "bidding" });
    const shareLink = (await host.locator("[data-invite-link]").innerText({ timeout: 15_000 })).trim();
    const url = new URL(shareLink);
    await guest.goto(`${url.pathname}${url.search}${url.hash}`);

    await expect(host.locator("[data-balances]")).toBeVisible({ timeout: 40_000 });
    await expect(guest.locator("[data-balances]")).toBeVisible({ timeout: 40_000 });

    for (const [i, cell] of FORCED_ONE_SIDED_OPENING.entries()) {
      const hostWins = i % 2 === 0;
      const winner = hostWins ? host : guest;
      const loser = hostWins ? guest : host;

      const target = winner.locator(`[data-cell="${cell}"]`);
      await expect(target).toHaveClass(/rev-cell--pick/, { timeout: 20_000 });
      await winner.locator(".bid-input__number").fill("2");
      await loser.locator(".bid-input__number").fill("1");
      await target.click();
      await loser.locator(".rev-cell--pick").first().click();

      // The winner pays 2 to the loser, so the host's balance alternates
      // 98 / 100 — a precise per-round sync point on BOTH clients.
      const expected = hostWins ? 98 : 100;
      await expect.poll(() => balanceValue(host, "p1"), { timeout: 20_000 }).toBe(expected);
      await expect.poll(() => balanceValue(guest, "p1"), { timeout: 20_000 }).toBe(expected);
    }

    // Dark (the host) now has no legal move; Light does. No auction runs.
    await expect(host.locator("[data-free-move]")).toContainText("you have no legal move", { timeout: 20_000 });
    await expect(guest.locator("[data-free-move]")).toContainText("your friend has no legal move");
    await expect(host.locator(".bid-input__number")).not.toBeEditable();
    await expect(guest.locator(".bid-input__number")).not.toBeEditable();
    await expect(host.locator(".rev-cell--pick")).toHaveCount(0);
    await expect(guest.locator(".rev-cell--pick").first()).toBeVisible();

    const before: [number, number] = [await balanceValue(host, "p1"), await balanceValue(host, "p2")];
    await guest.locator(".rev-cell--pick").first().click();

    // The free move lands on both boards and NOTHING is paid for it.
    await expect.poll(() => guest.locator(".game-log__entry-head").first().innerText()).toContain("free");
    await expect.poll(() => host.locator(".game-log__entry-head").first().innerText()).toContain("free");
    expect([await balanceValue(host, "p1"), await balanceValue(host, "p2")]).toEqual(before);
    expect([await balanceValue(guest, "p1"), await balanceValue(guest, "p2")]).toEqual(before);
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});

/** Dial a bid and commit it by clicking a cell — one gesture, as the UI
 *  intends (src/ui/ask-bid-move.ts). */
async function commitRound(page: Page, bid: number): Promise<void> {
  const input = page.locator(".bid-input__number");
  await input.fill(String(bid));
  await page.locator(".rev-cell--pick").first().click();
}

async function playUntilOver(a: Page, b: Page): Promise<number> {
  for (let i = 0; i < 500; i++) {
    const [aOver, bOver] = await Promise.all([
      a.locator("[data-match-over]").count(),
      b.locator("[data-match-over]").count(),
    ]);
    if (aOver > 0 && bOver > 0) return i;

    for (const page of [a, b]) {
      const input = page.locator(".bid-input__number");
      // A one-sided round takes no bid at all — the input stays disabled and
      // the mover simply plays (docs/DESIGN.md §Reversi).
      if ((await input.count()) > 0 && (await input.isEditable())) {
        await input.fill("7").catch(() => {});
      }
      const cell = page.locator(".rev-cell--pick").first();
      if ((await cell.count()) > 0) {
        await cell.click({ timeout: 5_000 }).catch(() => {});
      }
    }
    await a.waitForTimeout(120);
  }
  throw new Error("pvp bidding match did not finish in time");
}
