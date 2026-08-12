import { describe, it, expect, beforeEach } from "vitest";
import { createDiscScoreCard } from "./score-card";
import { counts, newGame, applyMove, DARK, cellOf } from "../engine/revplay";

beforeEach(() => {
  document.body.innerHTML = "";
});

function widthOf(el: Element | null): number {
  return Number.parseFloat((el as HTMLElement).style.width);
}

describe("disc-count race bar", () => {
  it("opens at the standard 2-2 position, split against the 64 cells", () => {
    const card = createDiscScoreCard({ p1Label: "You (dark)", p2Label: "Bot (light)" });
    document.body.append(card.el);

    const dark = card.el.querySelector('[data-race-fill="p1"]');
    const light = card.el.querySelector('[data-race-fill="p2"]');
    expect(widthOf(dark)).toBeCloseTo((2 / 64) * 100, 1);
    expect(widthOf(light)).toBeCloseTo((2 / 64) * 100, 1);
  });

  it("moves with the score after a real move", () => {
    const card = createDiscScoreCard({ p1Label: "You (dark)", p2Label: "Bot (light)" });
    document.body.append(card.el);

    // Dark plays d3 in the opening: 4 dark, 1 light.
    const after = applyMove(newGame(), DARK, cellOf(2, 3)).game;
    const [dark, light] = counts(after);
    expect([dark, light]).toEqual([4, 1]);

    card.update([dark, light]);
    expect(widthOf(card.el.querySelector('[data-race-fill="p1"]'))).toBeCloseTo((4 / 64) * 100, 1);
    expect(widthOf(card.el.querySelector('[data-race-fill="p2"]'))).toBeCloseTo((1 / 64) * 100, 1);
  });

  it("fills the whole track when the board is full", () => {
    const card = createDiscScoreCard({ p1Label: "Dark", p2Label: "Light" });
    card.update([33, 31]);
    const total =
      widthOf(card.el.querySelector('[data-race-fill="p1"]')) + widthOf(card.el.querySelector('[data-race-fill="p2"]'));
    expect(total).toBeCloseTo(100, 1);
  });

  it("keeps the kit's score rows in step with the bar", () => {
    const card = createDiscScoreCard({ p1Label: "You (dark)", p2Label: "Bot (light)" });
    card.update([40, 24]);
    const values = [...card.el.querySelectorAll(".score-card__value")].map((n) => n.textContent);
    expect(values).toEqual(["40", "24"]);
  });

  it("describes the split for screen readers", () => {
    const card = createDiscScoreCard({ p1Label: "You (dark)", p2Label: "Bot (light)" });
    card.update([40, 24]);
    expect(card.el.querySelector("[data-race]")?.getAttribute("aria-label")).toBe(
      "Discs on the board: You (dark) 40, Bot (light) 24, of 64 cells",
    );
  });
});
