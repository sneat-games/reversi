// Board notation and the small strings the board, the game log and the
// status cards all have to agree on. Kept DOM-free (and therefore trivially
// unit-testable) so `board.ts` and every session module name the same cell
// the same way.

import { BOARD_SIZE, rowOf, colOf, type Player, DARK } from "../engine/revplay";

/**
 * Standard Reversi/Othello notation: a column letter a–h and a 1-based row
 * number, e.g. cell index 19 (row 2, col 3) is "d3". This is the notation
 * printed in the game log and read out by every cell's `aria-label`.
 */
export function cellLabel(cell: number): string {
  return `${String.fromCharCode(97 + colOf(cell))}${rowOf(cell) + 1}`;
}

/** The same label from explicit grid coordinates. */
export function cellLabelAt(row: number, col: number): string {
  return cellLabel(row * BOARD_SIZE + col);
}

/** "dark"/"light" — the disc colour names used in aria-labels and copy. */
export function discName(player: Player): string {
  return player === DARK ? "dark" : "light";
}

/** "3 discs" / "1 disc" — used by cell aria-labels and the game log. */
export function discCount(n: number): string {
  return `${n} disc${n === 1 ? "" : "s"}`;
}
