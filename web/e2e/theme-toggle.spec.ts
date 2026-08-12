import { test, expect } from "@playwright/test";

// Journey 4 (game-kit/docs/DESIGN.md "Testing"): the theme toggle persists
// across a reload with no flash of the wrong theme — game-kit's ui/theme.ts
// stores the preference in `localStorage["sneat-games-theme"]`, and
// Layout.astro's pre-paint inline script (not a JS module import, which
// would run too late) re-applies it before first paint.

test("theme toggle persists across a reload", async ({ page }) => {
  await page.goto("/");

  const toggle = page.locator(".theme-toggle");
  await expect(toggle).toBeVisible();

  const before = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));

  await toggle.click();
  const after = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  expect(after).not.toBeNull();
  expect(after).not.toBe(before);
  expect(["light", "dark"]).toContain(after);

  const stored = await page.evaluate(() => localStorage.getItem("sneat-games-theme"));
  expect(stored).toBe(after);

  await page.reload();
  const afterReload = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  expect(afterReload).toBe(after);

  // The board's disc tokens are theme-aware overrides of the kit's --p1/--p2
  // (see src/styles/board.css), so they must resolve in whichever theme the
  // toggle landed on.
  const discColours = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return { p1: s.getPropertyValue("--p1").trim(), p2: s.getPropertyValue("--p2").trim() };
  });
  expect(discColours.p1).not.toBe("");
  expect(discColours.p2).not.toBe("");
  expect(discColours.p1).not.toBe(discColours.p2);
});

test("the standings preview shows a real local record and a labelled mock ladder", async ({ page }) => {
  await page.goto("/");
  await page.locator(".standings-trigger").click();

  const panel = page.locator("[data-standings-overlay]");
  await expect(panel).toBeVisible();
  await expect(panel.locator("[data-standings-record]")).toContainText("0W");
  await expect(panel.locator(".standings-panel__badge")).toHaveText("Powered by Competios — coming soon");

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("the cross-promotion footer links the other Sneat games", async ({ page }) => {
  await page.goto("/");
  const footer = page.locator("[data-games-footer]");
  await expect(footer).toBeVisible();
  await expect(footer.locator(".games-footer__pill", { hasText: "Hex" })).toBeVisible();
  // Never links itself.
  await expect(footer.locator(".games-footer__pill", { hasText: "Reversi" })).toHaveCount(0);
});
