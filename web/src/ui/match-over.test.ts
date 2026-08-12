import { describe, it, expect } from "vitest";
import { renderMatchOver, resultFor } from "./match-over";
import { Outcome, DARK, LIGHT } from "../engine/revplay";

describe("resultFor — how a finished game reads from your seat", () => {
  it("is a win for the side with more discs and a loss for the other", () => {
    expect(resultFor(Outcome.DarkWins, DARK)).toBe("win");
    expect(resultFor(Outcome.DarkWins, LIGHT)).toBe("loss");
    expect(resultFor(Outcome.LightWins, LIGHT)).toBe("win");
    expect(resultFor(Outcome.LightWins, DARK)).toBe("loss");
  });

  it("is a draw for both seats — Reversi genuinely draws", () => {
    expect(resultFor(Outcome.Draw, DARK)).toBe("draw");
    expect(resultFor(Outcome.Draw, LIGHT)).toBe("draw");
  });
});

describe("renderMatchOver", () => {
  it("names the final disc count in a win", () => {
    const el = renderMatchOver({
      outcome: Outcome.DarkWins,
      you: DARK,
      youLabel: "You",
      themLabel: "Bot",
      counts: [38, 26],
    });
    expect(el.getAttribute("data-outcome")).toBe("win");
    expect(el.className).toContain("match-over--win");
    expect(el.textContent).toContain("You win — 38 discs to 26.");
  });

  it("reads from the loser's seat with the counts the right way round", () => {
    const el = renderMatchOver({
      outcome: Outcome.DarkWins,
      you: LIGHT,
      youLabel: "You",
      themLabel: "Friend",
      counts: [38, 26],
    });
    expect(el.getAttribute("data-outcome")).toBe("loss");
    expect(el.textContent).toContain("Friend wins — 38 discs to 26.");
    expect(el.querySelector("[data-final-score]")?.getAttribute("data-final-score")).toBe("38-26");
  });

  it("has a draw state of its own", () => {
    const el = renderMatchOver({
      outcome: Outcome.Draw,
      you: DARK,
      youLabel: "You",
      themLabel: "Bot",
      counts: [32, 32],
    });
    expect(el.getAttribute("data-outcome")).toBe("draw");
    expect(el.className).toContain("match-over--draw");
    expect(el.textContent).toContain("Dead level — 32 discs each.");
  });

  it("adds the balances block with deltas in bidding mode only", () => {
    const classic = renderMatchOver({
      outcome: Outcome.DarkWins,
      you: DARK,
      youLabel: "You",
      themLabel: "Bot",
      counts: [33, 31],
    });
    expect(classic.querySelector(".match-over__balances")).toBeNull();

    const bidding = renderMatchOver({
      outcome: Outcome.DarkWins,
      you: DARK,
      youLabel: "You",
      themLabel: "Bot",
      counts: [33, 31],
      budgets: [70, 130],
      initialBudget: 100,
    });
    const deltas = [...bidding.querySelectorAll(".match-over__balance-delta")].map((n) => n.textContent);
    expect(deltas).toEqual(["-30", "+30"]); // first-price transfer: conserved
  });
});
