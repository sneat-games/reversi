// Port of server-go/revgame's board_test.go / board_more_test.go /
// moves_exported_test.go — same fixtures where the underlying RULE ported
// (see revplay.ts's "Deviations" header comment for what's intentionally
// NOT ported: base64/transcript/render, and the implicit Board.Last ->
// NextPlayer inference). describe() blocks are named after the Go test
// function they mirror so the mapping is auditable at a glance; blocks with
// no Go counterpart say so explicitly.
import { describe, it, expect } from "vitest";
import {
  DARK,
  LIGHT,
  BOARD_CELLS,
  cellOf,
  otherPlayer,
  newGame,
  legalMoves,
  mustPass,
  isOver,
  outcome,
  Outcome,
  counts,
  computeFlips,
  applyMove,
  AlreadyOccupiedError,
  NotValidMoveError,
  CellOutOfRangeError,
  type Board,
  type Disk,
  type Game,
} from "./revplay";

/** Test-only helper: build a sparse board from lists of dark/light cells (all other cells empty). Mirrors how the Go tests build a `Board{Blacks: ..., Whites: ...}` literal directly. */
function board(dark: number[], light: number[]): Board {
  const b: Disk[] = new Array<Disk>(BOARD_CELLS).fill(null);
  for (const c of dark) b[c] = DARK;
  for (const c of light) b[c] = LIGHT;
  return b;
}

function game(dark: number[], light: number[]): Game {
  return { board: board(dark, light) };
}

describe("TestOtherPlayer", () => {
  it("flips dark <-> light", () => {
    expect(otherPlayer(DARK)).toBe(LIGHT);
    expect(otherPlayer(LIGHT)).toBe(DARK);
  });
});

describe("TestOthelloBoard (initial position; Dark moves first)", () => {
  // Go's OthelloBoard sets Last to a White cell so NextPlayer() resolves to
  // Black first (TestOthelloBoard). We don't port that inference (see
  // revplay.ts's Deviations note) — the same fact, "Dark moves first", is
  // evidenced here by Dark having the standard opening moves available.
  it("Dark has the four standard Othello opening moves", () => {
    const g = newGame();
    const want = [
      cellOf(2, 3), // D3
      cellOf(3, 2), // C4
      cellOf(4, 5), // F5
      cellOf(5, 4), // E6
    ];
    expect(new Set(legalMoves(g, DARK))).toEqual(new Set(want));
  });
});

describe("TestBoard_ValidMoves_StartPosition", () => {
  it("Dark's four opening moves, and HasValidMoves is true", () => {
    const g = newGame();
    const want = new Set([cellOf(2, 3), cellOf(3, 2), cellOf(4, 5), cellOf(5, 4)]);
    expect(new Set(legalMoves(g, DARK))).toEqual(want);
    expect(mustPass(g, DARK)).toBe(false);
  });
});

describe("TestBoard_ValidMoves_NoMoves", () => {
  it("a lone Dark disc leaves Light with no legal move", () => {
    const g = game([cellOf(0, 0)], []);
    expect(legalMoves(g, LIGHT)).toEqual([]);
    expect(mustPass(g, LIGHT)).toBe(true);
  });
});

describe("TestBoard_MakeMove", () => {
  it("rejects an illegal opening move, then applies a legal sequence", () => {
    let g = newGame();

    // Dark at (1,1): not one of the four legal openings.
    expect(() => applyMove(g, DARK, cellOf(1, 1))).toThrow(NotValidMoveError);

    // D3: one of Dark's real opening moves.
    let res = applyMove(g, DARK, cellOf(2, 3));
    g = res.game;
    expect(res.flipped.length).toBeGreaterThan(0);

    // Light's reply.
    res = applyMove(g, LIGHT, cellOf(4, 2));
    g = res.game;
    expect(res.flipped.length).toBeGreaterThan(0);

    // Dark again.
    res = applyMove(g, DARK, cellOf(5, 2));
    g = res.game;
    expect(res.flipped.length).toBeGreaterThan(0);

    const [dark, light] = counts(g);
    expect(dark + light).toBeGreaterThan(4); // more discs than the opening position
  });
});

describe("TestBoard_MakeMove_OccupiedCell", () => {
  it("rejects a move onto an occupied cell and leaves the board unchanged", () => {
    const g = newGame();
    const before = g.board;
    expect(() => applyMove(g, DARK, cellOf(3, 3))).toThrow(AlreadyOccupiedError); // D4, already Light
    expect(g.board).toBe(before); // applyMove never mutates its input
  });
});

describe("TestBoard_getDisksToFlip_OpponentRunToEdge", () => {
  it("an opponent run that reaches the board edge with no capping disc flips nothing", () => {
    // White/Light run from (6,0) to the edge (7,0), no Black/Dark terminator.
    const b = board([], [cellOf(0, 6), cellOf(0, 7)]);
    expect(computeFlips(b, cellOf(0, 5), DARK)).toEqual([]);
  });
});

describe("TestBoard_getDisksToFlip_Panics (off-board case; unknown-player case has no TS equivalent — see revplay.ts Deviations)", () => {
  it("an out-of-range cell is rejected instead of panicking", () => {
    const g = newGame();
    expect(() => applyMove(g, DARK, -1)).toThrow(CellOutOfRangeError);
    expect(() => applyMove(g, DARK, BOARD_CELLS)).toThrow(CellOutOfRangeError);
  });
});

describe("TestBoard_NextPlayer_Branches (pass detection, ported as mustPass on the same board fixtures)", () => {
  // These two boards are lifted straight from board_more_test.go's
  // blackToMoveWhitePasses / whiteToMoveBlackPasses fixtures (translated
  // from Go's bitboard literals: 0xFC sets columns 2..7 of a row, `<<16`
  // moves that to row 2). The Go test asserts NextPlayer() stays with the
  // mover whose opponent has no reply; we assert the same underlying fact
  // directly: the opponent must pass, the mover does not.
  it("Light has no move, Dark does (Light passes)", () => {
    const dark = [
      cellOf(0, 2), cellOf(0, 3), cellOf(0, 4), cellOf(0, 5), cellOf(0, 6), cellOf(0, 7),
      cellOf(2, 2), cellOf(2, 3), cellOf(2, 4), cellOf(2, 5), cellOf(2, 6), cellOf(2, 7),
    ];
    const light = [cellOf(0, 1), cellOf(2, 1)];
    const g = game(dark, light);
    expect(mustPass(g, LIGHT)).toBe(true);
    expect(mustPass(g, DARK)).toBe(false);
  });

  it("colour-swapped: Dark has no move, Light does (Dark passes)", () => {
    const light = [
      cellOf(0, 2), cellOf(0, 3), cellOf(0, 4), cellOf(0, 5), cellOf(0, 6), cellOf(0, 7),
      cellOf(2, 2), cellOf(2, 3), cellOf(2, 4), cellOf(2, 5), cellOf(2, 6), cellOf(2, 7),
    ];
    const dark = [cellOf(0, 1), cellOf(2, 1)];
    const g = game(dark, light);
    expect(mustPass(g, DARK)).toBe(true);
    expect(mustPass(g, LIGHT)).toBe(false);
  });

  it("a single Dark disc: game is over, Dark wins (board_more_test's black-last->completed)", () => {
    const g = game([cellOf(0, 0)], []);
    expect(isOver(g)).toBe(true);
    expect(outcome(g)).toBe(Outcome.DarkWins);
  });

  it("a single Light disc: game is over, Light wins (board_more_test's white-last->completed)", () => {
    const g = game([], [cellOf(0, 0)]);
    expect(isOver(g)).toBe(true);
    expect(outcome(g)).toBe(Outcome.LightWins);
  });

  // NOT ported: board_more_test.go's "empty-last" parity cases and
  // TestBoard_NextPlayer_EmptyLastTooManyTurnsPanics. Both test Go's
  // Board.Last-inference machinery for a board built without ever calling
  // MakeMove — machinery this port deliberately drops (see revplay.ts
  // Deviations). There is no mustPass/isOver equivalent to assert, because
  // there is no "last address" input to infer from in the first place.
});

describe("TestBoard_IsCompleted", () => {
  it("a single-disc board is over; the opening position is not", () => {
    const completed = game([cellOf(0, 0)], []);
    expect(isOver(completed)).toBe(true);
    expect(isOver(newGame())).toBe(false);
  });
});

describe("TestBoard_Scores_And_Score", () => {
  it("the opening position has 2 discs each", () => {
    expect(counts(newGame())).toEqual([2, 2]);
  });
});

describe("endgame outcome: Dark/Light/Draw by disc count (new — revgame has no Outcome concept, only Scores()/IsCompleted(); see revplay.ts's Outcome doc comment)", () => {
  it("classifies a Dark majority, a Light majority, and an even split", () => {
    const darkCells = Array.from({ length: 40 }, (_, i) => i);
    const lightCells = Array.from({ length: 24 }, (_, i) => 40 + i);
    const darkWins = game(darkCells, lightCells);
    expect(isOver(darkWins)).toBe(true);
    expect(outcome(darkWins)).toBe(Outcome.DarkWins);

    const lightWins = game(lightCells, darkCells);
    expect(outcome(lightWins)).toBe(Outcome.LightWins);

    const half = Array.from({ length: 32 }, (_, i) => i);
    const otherHalf = Array.from({ length: 32 }, (_, i) => 32 + i);
    const draw = game(half, otherHalf);
    expect(isOver(draw)).toBe(true);
    expect(outcome(draw)).toBe(Outcome.Draw);
  });

  it("an ongoing game reports Outcome.Ongoing", () => {
    expect(outcome(newGame())).toBe(Outcome.Ongoing);
  });
});

describe("flip search — all 8 directions (new: board_test.go exercises flips incidentally via a few real moves; this drives each direction independently so a bug in any one of the 8 branches trips a failure)", () => {
  // Anchor the move at (row 4, col 4); for each direction, place a Light
  // disc one step away and a Dark capping disc two steps away. Only those
  // two cells (plus the empty move cell) are set — everything else on the
  // board stays empty, so a passing case proves that ONE direction's scan
  // is correct in isolation.
  const cases: Array<{ name: string; dx: number; dy: number }> = [
    { name: "down", dx: 0, dy: 1 },
    { name: "down-right", dx: 1, dy: 1 },
    { name: "right", dx: 1, dy: 0 },
    { name: "up-right", dx: 1, dy: -1 },
    { name: "up", dx: 0, dy: -1 },
    { name: "up-left", dx: -1, dy: -1 },
    { name: "left", dx: -1, dy: 0 },
    { name: "down-left", dx: -1, dy: 1 },
  ];

  for (const { name, dx, dy } of cases) {
    it(name, () => {
      const startRow = 4;
      const startCol = 4;
      const neighbour = cellOf(startRow + dy, startCol + dx);
      const capper = cellOf(startRow + 2 * dy, startCol + 2 * dx);
      const b = board([capper], [neighbour]);
      expect(computeFlips(b, cellOf(startRow, startCol), DARK)).toEqual([neighbour]);
    });
  }
});
