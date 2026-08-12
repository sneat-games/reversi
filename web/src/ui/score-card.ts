// The disc-count card: game-kit's `createScoreCard` (same slot, same width,
// same colour-coded rows as every other kit game) with one Reversi-specific
// addition at the top — the DISC-COUNT RACE BAR.
//
// Reversi's score is not a tally that only grows: a single move can hand a
// dozen discs across, and the lead swings back and forth all game. A pair of
// numbers reports that badly; one bar, split dark-from-the-left and
// light-from-the-right against the 64 cells of the board, shows both the
// lead AND how much board is still unclaimed, and animates the swing on
// every move (the fills are plain width transitions — see styles/board.css).
//
// The kit's card is composed, not reimplemented: `update()` here drives the
// kit's own rows and this bar together.

import { createScoreCard, type ScoreCard } from "@sneat/game-kit";
import { BOARD_CELLS } from "../engine/revplay";

export interface DiscScoreCard {
  el: HTMLElement;
  /** Redraw rows and race bar from the current counts `[dark, light]`. */
  update(counts: readonly [number, number]): void;
}

export function createDiscScoreCard(opts: { p1Label: string; p2Label: string }): DiscScoreCard {
  const card: ScoreCard = createScoreCard({ p1Label: opts.p1Label, p2Label: opts.p2Label });
  card.el.setAttribute("data-disc-score-card", "");

  const race = document.createElement("div");
  race.className = "rev-race";
  race.setAttribute("data-race", "");
  race.setAttribute("role", "img");

  const track = document.createElement("div");
  track.className = "rev-race__track";

  const darkFill = document.createElement("div");
  darkFill.className = "rev-race__fill rev-race__fill--p1";
  darkFill.setAttribute("data-race-fill", "p1");

  const lightFill = document.createElement("div");
  lightFill.className = "rev-race__fill rev-race__fill--p2";
  lightFill.setAttribute("data-race-fill", "p2");

  track.append(darkFill, lightFill);
  race.append(track);

  // Between the card title and the kit's own rows.
  const rows = card.el.querySelector(".score-card__rows");
  card.el.insertBefore(race, rows ?? null);

  function update(counts: readonly [number, number]) {
    card.update([counts[0], counts[1]]);
    const dark = Math.max(0, counts[0]);
    const light = Math.max(0, counts[1]);
    darkFill.style.width = `${((dark / BOARD_CELLS) * 100).toFixed(1)}%`;
    lightFill.style.width = `${((light / BOARD_CELLS) * 100).toFixed(1)}%`;
    race.setAttribute(
      "aria-label",
      `Discs on the board: ${opts.p1Label} ${dark}, ${opts.p2Label} ${light}, of ${BOARD_CELLS} cells`,
    );
  }

  update([2, 2]); // the standard opening position

  return { el: card.el, update };
}
