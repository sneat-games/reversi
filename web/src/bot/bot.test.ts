// Port of server-go/revgame's ai_test.go where portable, plus new tests for
// isDecisive/pickBid — the bidding-variant helpers revgame has no
// equivalent of (see bot.ts's header comment).
import { describe, it, expect } from "vitest";
import { pickMove, isDecisive, pickBid, __test } from "./bot";
import {
  DARK,
  LIGHT,
  BOARD_CELLS,
  cellOf,
  newGame,
  legalMoves,
  applyMove,
  type Board,
  type Disk,
  type Game,
} from "../engine/revplay";

const { isCorner } = __test;

function board(dark: number[], light: number[]): Board {
  const b: Disk[] = new Array<Disk>(BOARD_CELLS).fill(null);
  for (const c of dark) b[c] = DARK;
  for (const c of light) b[c] = LIGHT;
  return b;
}

function game(dark: number[], light: number[]): Game {
  return { board: board(dark, light) };
}

describe("isCorner", () => {
  it("is true only for the four corner cells", () => {
    expect(isCorner(cellOf(0, 0))).toBe(true);
    expect(isCorner(cellOf(0, 7))).toBe(true);
    expect(isCorner(cellOf(7, 0))).toBe(true);
    expect(isCorner(cellOf(7, 7))).toBe(true);
    expect(isCorner(cellOf(0, 1))).toBe(false);
    expect(isCorner(cellOf(4, 4))).toBe(false);
  });
});

describe("TestSimpleAI_GetMove_PrefersCorner", () => {
  it("Light's only move is a corner; any corner beats all non-corner moves", () => {
    // Black/Dark at (1,0), White/Light at (2,0): Light's single legal move
    // is the corner (0,0), flanking Dark's disc between it and Light's own
    // disc at (2,0).
    const g = game([cellOf(0, 1)], [cellOf(0, 2)]);
    const move = pickMove(g, LIGHT);
    expect(move).toBe(cellOf(0, 0));
  });
});

describe("TestSimpleAI_GetMove_TieBreak", () => {
  it("two symmetric corner moves score equally; the tie-break returns one of them", () => {
    const g = game(
      [cellOf(0, 1), cellOf(7, 1)], // (1,0) and (1,7)
      [cellOf(0, 2), cellOf(7, 2)], // (2,0) and (2,7)
    );
    const valid = new Set(legalMoves(g, LIGHT));
    expect(valid).toEqual(new Set([cellOf(0, 0), cellOf(7, 0)]));

    for (let i = 0; i < 50; i++) {
      const move = pickMove(g, LIGHT);
      expect([cellOf(0, 0), cellOf(7, 0)]).toContain(move);
    }
  });
});

describe("TestSimpleAI_GetMove", () => {
  it("picks the deterministic best-score move on a mixed board", () => {
    // OthelloBoard plus three extra Dark discs (mirrors ai_test.go's
    // board.Blacks.add({3,5}), add({3,6}), add({2,4})).
    let g = newGame();
    ({ game: g } = applyMoveRaw(g, DARK, cellOf(5, 3)));
    ({ game: g } = applyMoveRaw(g, DARK, cellOf(6, 3)));
    ({ game: g } = applyMoveRaw(g, DARK, cellOf(4, 2)));

    const move = pickMove(g, LIGHT);
    expect(move).toBe(cellOf(7, 3)); // Go's expected Address{X:3, Y:7}
  });
});

// ai_test.go builds its mixed board by adding discs directly to the
// bitboard (board.Blacks.add(...)), bypassing MakeMove's legality checks
// entirely — there is no equivalent "just place a disc" primitive in this
// port (applyMove always validates), so this small helper reproduces the
// same final board by placing discs directly rather than by legal play.
function applyMoveRaw(g: Game, player: 0 | 1, cell: number): { game: Game } {
  const b = g.board.slice() as Disk[];
  b[cell] = player;
  return { game: { board: b } };
}

describe("isDecisive (new — no Go equivalent, see bot.ts header)", () => {
  it("is true when the mover itself can take a corner", () => {
    const g = game([cellOf(0, 1)], [cellOf(0, 2)]); // Light's only move is the corner (0,0)
    expect(isDecisive(g, LIGHT)).toBe(true);
  });

  it("is true when only the OPPONENT can take a corner", () => {
    const g = game([cellOf(0, 1)], [cellOf(0, 2)]);
    // Dark itself has a legal (non-corner) move at (3,0), flanking Light's
    // disc at (2,0) against Dark's own disc at (1,0); Light separately has
    // the corner move. Decisive for Dark too, because it checks either side.
    expect(legalMoves(g, DARK)).toContain(cellOf(0, 3));
    expect(isDecisive(g, DARK)).toBe(true);
  });

  it("is false for an ordinary opening move, far from any corner or game end", () => {
    expect(isDecisive(newGame(), DARK)).toBe(false);
  });

  it("is true when a legal (non-corner) move would end the game", () => {
    // A board filled everywhere except one non-corner cell, (0,1): playing
    // it is legal (flips (1,1)) and fills the board, ending the game.
    const b: Disk[] = new Array<Disk>(BOARD_CELLS).fill(LIGHT);
    b[cellOf(0, 1)] = null;
    b[cellOf(2, 1)] = DARK; // caps the (1,1) Light disc when Dark plays (0,1)
    const g: Game = { board: b };

    expect(legalMoves(g, DARK)).toEqual([cellOf(0, 1)]);
    const { game: next } = applyMove(g, DARK, cellOf(0, 1));
    expect(next.board.every((d) => d !== null)).toBe(true); // board is now full
    expect(isDecisive(g, DARK)).toBe(true);
  });
});

describe("pickBid (new — reuses BTTT's restrained shape; see bot.ts header)", () => {
  it("bids opponentBudget+1 when decisive and strictly richer", () => {
    expect(pickBid({ budgetRemaining: 160, opponentBudget: 40, decisive: true })).toBe(41);
  });

  it("cannot be outbid by anything the opponent can afford, across a range of budgets", () => {
    for (let opp = 0; opp <= 60; opp++) {
      const bid = pickBid({ budgetRemaining: opp + 5, opponentBudget: opp, decisive: true });
      expect(bid).toBeGreaterThan(opp);
      expect(bid).toBeLessThanOrEqual(opp + 5);
    }
  });

  it("falls back to ~1/3 when decisive but not affordably richer", () => {
    expect(pickBid({ budgetRemaining: 100, opponentBudget: 100, decisive: true })).toBe(33);
    expect(pickBid({ budgetRemaining: 40, opponentBudget: 160, decisive: true })).toBe(13);
  });

  it("bids ~1/6 with small jitter on an ordinary round", () => {
    for (let i = 0; i < 20; i++) {
      const bid = pickBid({ budgetRemaining: 60, opponentBudget: 60, decisive: false });
      expect(bid).toBeGreaterThanOrEqual(9); // floor(60/6) - 1
      expect(bid).toBeLessThanOrEqual(11); // floor(60/6) + 1
    }
  });

  it("bids 0 when broke, decisive or not", () => {
    expect(pickBid({ budgetRemaining: 0, opponentBudget: 40, decisive: true })).toBe(0);
    expect(pickBid({ budgetRemaining: 0, opponentBudget: 40, decisive: false })).toBe(0);
  });

  it("never bids more than budgetRemaining", () => {
    for (let i = 0; i < 20; i++) {
      const bid = pickBid({ budgetRemaining: 2, opponentBudget: 2, decisive: false });
      expect(bid).toBeLessThanOrEqual(2);
      expect(bid).toBeGreaterThanOrEqual(0);
    }
  });
});
