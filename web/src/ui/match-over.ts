// The end-of-match banner. game-kit's match-shell.ts deliberately ships no
// generic version of this (its doc comment: only the game knows what "win"
// means on its board), so Reversi builds its own — styled entirely through
// theme.css's `.match-over` family, which IS shared chrome and already
// carries a `--draw` variant.
//
// Unlike Hex, Reversi HAS draws and always has a score, so the headline
// always names the final disc count; bidding mode adds the familiar
// balances-with-deltas block underneath.

import { Outcome } from "../engine/revplay";

export type MatchResult = "win" | "loss" | "draw";

export interface MatchOverOptions {
  outcome: Outcome;
  /** Which player the local viewer is. */
  you: 0 | 1;
  youLabel: string;
  themLabel: string;
  /** Final disc counts `[dark, light]`. */
  counts: readonly [number, number];
  /** Bidding mode only: final budgets `[player0, player1]` + the start. */
  budgets?: readonly [number, number];
  initialBudget?: number;
}

/** How a finished game reads from the local player's seat. */
export function resultFor(outcome: Outcome, you: 0 | 1): MatchResult {
  if (outcome === Outcome.Draw) return "draw";
  const winner = outcome === Outcome.DarkWins ? 0 : 1;
  return winner === you ? "win" : "loss";
}

export function renderMatchOver(opts: MatchOverOptions): HTMLElement {
  const { outcome, you, youLabel, themLabel, counts } = opts;
  const result = resultFor(outcome, you);
  const them: 0 | 1 = you === 0 ? 1 : 0;
  const mine = counts[you];
  const theirs = counts[them];

  const el = document.createElement("div");
  el.className = `match-over match-over--${result}`;
  el.setAttribute("data-match-over", "");
  el.setAttribute("data-outcome", result);

  const headline = document.createElement("p");
  headline.className = "match-over__headline";
  headline.textContent =
    result === "draw"
      ? `Dead level — ${mine} discs each.`
      : result === "win"
        ? `${youLabel} win — ${mine} discs to ${theirs}.`
        : `${themLabel} wins — ${theirs} discs to ${mine}.`;
  el.append(headline);

  const detail = document.createElement("p");
  detail.className = "match-over__detail";
  detail.setAttribute("data-final-score", `${counts[0]}-${counts[1]}`);
  detail.textContent = `Final discs — ${youLabel}: ${mine}, ${themLabel}: ${theirs}.`;
  el.append(detail);

  if (opts.budgets && opts.initialBudget !== undefined) {
    const box = document.createElement("div");
    box.className = "match-over__balances";
    box.append(
      balanceRow(youLabel, opts.budgets[you], opts.initialBudget),
      balanceRow(themLabel, opts.budgets[them], opts.initialBudget),
    );
    el.append(box);
  }

  return el;
}

function balanceRow(label: string, value: number, initial: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "match-over__balance";

  const l = document.createElement("span");
  l.className = "match-over__balance-label";
  l.textContent = label;

  const v = document.createElement("span");
  v.className = "match-over__balance-value";
  v.textContent = String(value);

  const delta = value - initial;
  const d = document.createElement("span");
  d.className = `match-over__balance-delta${
    delta > 0 ? " match-over__balance-delta--up" : delta < 0 ? " match-over__balance-delta--down" : ""
  }`;
  d.textContent = delta === 0 ? "±0" : delta > 0 ? `+${delta}` : String(delta);

  row.append(l, v, d);
  return row;
}
