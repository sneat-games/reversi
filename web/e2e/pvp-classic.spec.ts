import { test, expect, type Page } from "@playwright/test";
import { chooseMenuAndPlay } from "./helpers";

// Journey 3 (game-kit/docs/DESIGN.md "Testing"): host <-> guest full PvP
// match across two browser contexts against the local relay stub (game-kit's
// test-relay.mjs, started as this config's second webServer). The guest
// never sees the menu — it joins purely off the invite link and learns the
// match's variant from the host's `hello` (see src/ui/vs-friend.ts).

test("PvP classic: invite link connects two browsers and both boards agree on the result", async ({ browser }) => {
  test.setTimeout(180_000);

  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  try {
    await host.goto("/");
    await chooseMenuAndPlay(host, { mode: "vs-friend", variant: "classic" });

    const link = host.locator("[data-invite-link]");
    await expect(link).toBeVisible({ timeout: 15_000 });
    const shareLink = (await link.innerText()).trim();
    const url = new URL(shareLink);

    await guest.goto(`${url.pathname}${url.search}${url.hash}`);

    // Both sides reach the match screen once the WebRTC handshake and the
    // `hello`/`hello-ack` config negotiation complete.
    await expect(host.locator("[data-disc-score-card]")).toBeVisible({ timeout: 40_000 });
    await expect(guest.locator("[data-disc-score-card]")).toBeVisible({ timeout: 40_000 });

    // Host is Dark and moves first, so only the host has legal cells now.
    await expect(host.locator(".rev-cell--pick")).toHaveCount(4, { timeout: 15_000 });
    await expect(guest.locator(".rev-cell--pick")).toHaveCount(0);

    await playUntilOver(host, guest);

    const hostOver = host.locator("[data-match-over]");
    const guestOver = guest.locator("[data-match-over]");
    await expect(hostOver).toBeVisible();
    await expect(guestOver).toBeVisible();

    // The two boards agree: either one won and the other lost, or both
    // drew. A real disagreement would have hung one side instead.
    const outcomes = [await hostOver.getAttribute("data-outcome"), await guestOver.getAttribute("data-outcome")];
    expect([["draw", "draw"], ["loss", "win"]]).toContainEqual([...outcomes].sort());

    // Both sides show the same final disc count.
    const finalScore = await hostOver.locator("[data-final-score]").getAttribute("data-final-score");
    expect(finalScore).toBe(await guestOver.locator("[data-final-score]").getAttribute("data-final-score"));

    // Reversi ends either with a full/blocked board OR by annihilation (one
    // colour wiped out leaves BOTH sides without a legal move) — a real,
    // often quick, terminal state that first-legal-cell play reaches often.
    // Log which one this run produced so a suspiciously fast pass is
    // explainable rather than mysterious.
    const [dark, light] = (finalScore ?? "0-0").split("-").map(Number);
    console.log(`[pvp classic] final discs dark=${dark} light=${light} (total ${dark + light})`);
    expect(dark + light).toBeGreaterThanOrEqual(4);
    expect(dark === 0 || light === 0 || dark + light >= 10).toBe(true);
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});

/**
 * The shortest opening (found by breadth-first search over the real engine)
 * after which the side to move has NO legal move while the game is very much
 * still alive: d3 c3 b3 b2 f5 a3 a1 c1, alternating from the host. After the
 * guest's c1, the HOST must pass.
 *
 * A forced pass cannot be produced on demand against the bot (its tie-break
 * is random, and a pass turns up in only ~70% of matches), but in PvP both
 * sides are ours to drive — so the pass journey is exercised end to end here,
 * deterministically, rather than left to chance.
 */
const FORCED_PASS_OPENING = [19, 18, 17, 9, 37, 16, 0, 2];

test("PvP classic: a forced pass is announced on both sides and play continues", async ({ browser }) => {
  test.setTimeout(180_000);

  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  try {
    await host.goto("/");
    await chooseMenuAndPlay(host, { mode: "vs-friend", variant: "classic" });
    const shareLink = (await host.locator("[data-invite-link]").innerText({ timeout: 15_000 })).trim();
    const url = new URL(shareLink);
    await guest.goto(`${url.pathname}${url.search}${url.hash}`);

    await expect(host.locator("[data-disc-score-card]")).toBeVisible({ timeout: 40_000 });
    await expect(guest.locator("[data-disc-score-card]")).toBeVisible({ timeout: 40_000 });

    for (const [i, cell] of FORCED_PASS_OPENING.entries()) {
      const page = i % 2 === 0 ? host : guest;
      const target = page.locator(`[data-cell="${cell}"]`);
      await expect(target).toHaveClass(/rev-cell--pick/, { timeout: 20_000 });
      await target.click();
    }

    // The host has no legal move: an unmissable banner, a Pass button, and
    // the guest told why the turn is coming straight back to them.
    const hostPass = host.locator("[data-pass-notice]");
    await expect(hostPass).toBeVisible({ timeout: 20_000 });
    await expect(hostPass).toContainText("You must pass");
    await expect(host.locator("[data-pass-button]")).toBeVisible();
    await expect(guest.locator("[data-pass-notice]")).toContainText("your friend passes", { timeout: 20_000 });

    // While the banner is up the Pass button is the only thing in the match
    // area that can be pressed (see src/ui/pass-banner.ts's lockScope).
    const enabled = host.locator(".match button:not([disabled])");
    await expect(enabled).toHaveCount(1);

    await host.locator("[data-pass-button]").click();
    await expect(host.locator("[data-pass-button]")).toHaveCount(0);

    // The turn really did go back to the guest, and the match plays on.
    await expect(guest.locator(".rev-cell--pick").first()).toBeVisible({ timeout: 20_000 });

    await playUntilOver(host, guest);
    await expect(host.locator("[data-match-over]")).toBeVisible();
    await expect(guest.locator("[data-match-over]")).toBeVisible();
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});

/** Drive both peers: whoever has a legal cell clicks the first one, and
 *  whoever is shown the pass banner acknowledges it (while it is up, it is
 *  the only enabled control, so the match cannot proceed otherwise). */
async function playUntilOver(a: Page, b: Page): Promise<void> {
  for (let i = 0; i < 500; i++) {
    const [aOver, bOver] = await Promise.all([
      a.locator("[data-match-over]").count(),
      b.locator("[data-match-over]").count(),
    ]);
    if (aOver > 0 && bOver > 0) return;

    for (const page of [a, b]) {
      const pass = page.locator("[data-pass-button]");
      if ((await pass.count()) > 0) {
        await pass.click({ timeout: 5_000 }).catch(() => {});
        continue;
      }
      const cell = page.locator(".rev-cell--pick").first();
      if ((await cell.count()) > 0) {
        await cell.click({ timeout: 5_000 }).catch(() => {});
      }
    }
    await a.waitForTimeout(120);
  }
  throw new Error("pvp classic match did not finish in time");
}
