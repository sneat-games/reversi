// Port of server-go/revgame — the resolution engine for Reversi/Othello.
//
// This file is a faithful vanilla TypeScript mirror of the Go rule-of-record
// at ../../../server-go/revgame/{board,disks,celladdress,moves_exported}.go.
// It ports the RULES only, not revgame's Telegram-specific encoding: no
// int64 bitboard (Disks), no base64 snapshot round-trip, no transcript/
// replay, no text/emoji board rendering. Any rule change in the Go package
// should trip a corresponding failure here (see revplay.test.ts, which names
// its describe blocks after the Go test functions it mirrors so the mapping
// stays auditable).
//
// # Colour mapping
//
// Go's `Disk` is a rune: Black ('b'), White ('w'), Empty (' '). We map:
//   Black -> Dark  -> 0
//   White -> Light -> 1
//   Empty -> null
// "Dark"/"Light" rather than "Black"/"White" because the web variant's own
// disc styling (near-black / near-ivory, see game-kit/docs/DESIGN.md
// §Reversi) is deliberately not pure black/white.
//
// Board.go's `OthelloBoard` sets Blacks at Address{X:4,Y:3} (E4) and
// Address{X:3,Y:4} (D5), Whites at Address{X:3,Y:3} (D4) and Address{X:4,Y:4}
// (E5), with `Last: Address{4,4}` (a White cell) — which is how
// `Board.NextPlayer()` infers Black moves first. We don't port that implicit
// last-mover inference (see "Deviations" below); instead every function here
// takes the player explicitly. TestOthelloBoard confirms Black (-> Dark)
// moves first in the standard position, which this port preserves as-is —
// there is no conflict to flag.
//
// # Board representation
//
// Go stores each colour as an int64 bitboard (`Disks`) with
// `Address.Index() == Y*BoardSize + X`. We use a plain `Disk[64]` array
// instead (cell == row*8 + col, i.e. the same Y*8+X indexing, just not
// bit-packed) per this port's brief. This is a pure encoding change with no
// rule consequence, and it eliminates a whole class of Go-only bugs: a cell
// can no longer be "both colours at once", so board.go's
// `TestBoard_flip_OverlapPanics` guard has no TS equivalent — the invalid
// state is unrepresentable rather than merely panicking.
//
// # Deviations from board.go (all intentional, all noted here once)
//
//   - No `Board.Last` / `NextPlayer()` implicit turn inference. revgame
//     infers whose turn it is from the disk at the last-played address
//     (board.go's NextPlayer, exercised by board_more_test.go's
//     TestBoard_NextPlayer_Branches). That machinery exists to serialise a
//     "whose turn" bit for the Telegram bot's persisted snapshot. It also
//     assumes strict alternation, which doesn't hold for the bidding variant
//     (game-kit/docs/DESIGN.md §Reversi) where both players submit a move
//     against the SAME position every round — there is no fixed "next
//     player" to infer. So every function here takes `player` explicitly;
//     the caller (a later wave's session layer) tracks turn order. The
//     underlying RULE this machinery protects — a player with no legal move
//     passes — is still fully ported, as `mustPass`/`isOver`; see
//     revplay.test.ts's "pass detection" describe block, which rebuilds
//     board_more_test.go's TestBoard_NextPlayer_Branches board fixtures and
//     asserts mustPass() on them directly instead of NextPlayer().
//   - No UndoMove/replay/transcript/base64 — out of scope per this port's
//     brief (Telegram persistence, not game rules).
//   - No `unknown player` runtime panics (Go's OtherPlayer/Score/
//     getDisksToFlip `default:` panic branches for a Disk that is neither
//     Black nor White). `Player` here is the TS union `0 | 1`, so passing
//     anything else is a compile-time type error, not a runtime concern —
//     strictly stronger than Go's panic, so there is nothing to test at
//     runtime.
//   - `computeFlips` (this file's mirror of Go's unexported
//     `getDisksToFlip`) does NOT itself check whether `start` is occupied.
//     Go's function shares one occupancy check between its two callers
//     (`MakeMove` and `getValidMoves`) by folding it into
//     `getDisksToFlip` itself; here the two call sites (`applyMove`,
//     `legalMoves`) each do the (trivial, one-line) check themselves, which
//     reads more directly than threading an error return through a pure
//     scan function. Behaviour is identical either way.

/** A disc colour, or `null` for an empty cell. */
export type Disk = 0 | 1 | null;
/** A disc colour — never `null`. What every function below expects for "which player". */
export type Player = 0 | 1;

/** Dark disc (mirrors Go's Black). */
export const DARK: Player = 0;
/** Light disc (mirrors Go's White). */
export const LIGHT: Player = 1;

/** otherPlayer mirrors board.go's `OtherPlayer`. */
export function otherPlayer(player: Player): Player {
  return player === DARK ? LIGHT : DARK;
}

export const BOARD_SIZE = 8;
export const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;

/** cellOf converts zero-based (row, col) grid coordinates to a cell index, mirroring board.go's `Address.Index()` (== Y*8 + X). */
export function cellOf(row: number, col: number): number {
  return row * BOARD_SIZE + col;
}

/** rowOf is the inverse of cellOf's row component. */
export function rowOf(cell: number): number {
  return Math.floor(cell / BOARD_SIZE);
}

/** colOf is the inverse of cellOf's col component. */
export function colOf(cell: number): number {
  return cell % BOARD_SIZE;
}

/** Board is 64 cells, row-major (cell = row*8 + col). */
export type Board = readonly Disk[];

/**
 * initialBoard mirrors board.go's `OthelloBoard`: the standard Othello
 * opening, a diagonal 2x2 of discs at the board's centre. Go's literal is
 * `Blacks: (1<<(3*8+4)) | (1<<(4*8+3))`, `Whites: (1<<(3*8+3)) |
 * (1<<(4*8+4))` — i.e. Black/Dark at E4 and D5, White/Light at D4 and E5.
 */
export function initialBoard(): Board {
  const board: Disk[] = new Array<Disk>(BOARD_CELLS).fill(null);
  board[cellOf(3, 4)] = DARK; // E4
  board[cellOf(4, 3)] = DARK; // D5
  board[cellOf(3, 3)] = LIGHT; // D4
  board[cellOf(4, 4)] = LIGHT; // E5
  return board;
}

/** Game wraps the board. There is deliberately no extra state — see "Deviations" above for why turn order lives with the caller, not here. */
export interface Game {
  readonly board: Board;
}

/** newGame returns a fresh game in the standard Othello opening position. */
export function newGame(): Game {
  return { board: initialBoard() };
}

function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

interface Direction {
  readonly dx: number;
  readonly dy: number;
}

// The same 8 directions, in the same order, as board.go's `directions` var,
// so the two are easy to eyeball side by side.
const DIRECTIONS: readonly Direction[] = [
  { dx: 0, dy: 1 }, // down
  { dx: 1, dy: 1 }, // down-right
  { dx: 1, dy: 0 }, // right
  { dx: 1, dy: -1 }, // up-right
  { dx: 0, dy: -1 }, // up
  { dx: -1, dy: -1 }, // up-left
  { dx: -1, dy: 0 }, // left
  { dx: -1, dy: 1 }, // down-left
];

/**
 * computeFlips finds every opponent disc that placing `player` at `start`
 * would flip. It assumes `start` is empty — see the "Deviations" note above
 * for why the occupancy check lives at the call sites instead.
 *
 * Algorithm (mirrors board.go's `getDisksToFlip`): scan outward from `start`
 * in each of the 8 directions in turn. A direction contributes flips only if
 * the cell immediately next to `start` holds an OPPONENT disc — otherwise
 * there is nothing to flank. If it does, keep walking through the run of
 * opponent discs; if that run is eventually "capped" by a disc of `player`'s
 * own colour before running off the board, every opponent disc between
 * `start` and the cap flips. Running off the board, or hitting an empty
 * cell, before finding a capping disc means that direction flips nothing
 * (this also covers board_test.go's `TestBoard_getDisksToFlip_
 * OpponentRunToEdge`: an opponent run that reaches the edge with no
 * terminating disc of the mover's own colour never flips).
 *
 * Exported (rather than kept private) so it can be exercised directly in
 * tests, the same way board_test.go tests Go's unexported `getDisksToFlip`
 * from within the same package — `legalMoves`/`applyMove` also use it, so
 * this is the one place the flip rule is implemented.
 */
export function computeFlips(board: Board, start: number, player: Player): number[] {
  const opponent = otherPlayer(player);
  const startRow = rowOf(start);
  const startCol = colOf(start);
  const flips: number[] = [];

  for (const { dx, dy } of DIRECTIONS) {
    let row = startRow + dy;
    let col = startCol + dx;
    // The immediately adjacent cell must hold an opponent disc, or this
    // direction flanks nothing.
    if (!inBounds(row, col) || board[cellOf(row, col)] !== opponent) continue;

    // Walk through the run of opponent discs.
    row += dy;
    col += dx;
    while (inBounds(row, col) && board[cellOf(row, col)] === opponent) {
      row += dy;
      col += dx;
    }

    // The run must be capped by the mover's own disc, still on the board,
    // for any of it to flip.
    if (inBounds(row, col) && board[cellOf(row, col)] === player) {
      let backRow = row - dy;
      let backCol = col - dx;
      while (backRow !== startRow || backCol !== startCol) {
        flips.push(cellOf(backRow, backCol));
        backRow -= dy;
        backCol -= dx;
      }
    }
  }

  return flips;
}

/** legalMoves mirrors moves_exported.go's `Board.ValidMoves` (itself an exported wrapper over board.go's unexported `getValidMoves`). */
export function legalMoves(g: Game, player: Player): number[] {
  const moves: number[] = [];
  for (let cell = 0; cell < BOARD_CELLS; cell++) {
    if (g.board[cell] !== null) continue; // occupied cells are never legal
    if (computeFlips(g.board, cell, player).length > 0) moves.push(cell);
  }
  return moves;
}

/** mustPass mirrors moves_exported.go's `Board.HasValidMoves`, inverted: true when `player` has no legal move and must pass. */
export function mustPass(g: Game, player: Player): boolean {
  return legalMoves(g, player).length === 0;
}

function isBoardFull(board: Board): boolean {
  for (const cell of board) {
    if (cell === null) return false;
  }
  return true;
}

/**
 * isOver reports whether the game has ended: neither player has a legal
 * move (the double-pass condition board.go's `NextPlayer` reports as
 * `Completed`), OR the board is completely full. In practice these always
 * coincide — a legal move requires an empty target cell, so a full board
 * already makes `mustPass` true for both colours — but both conditions are
 * checked explicitly because that is the rule as specified, and it
 * documents the invariant rather than silently relying on it.
 */
export function isOver(g: Game): boolean {
  return isBoardFull(g.board) || (mustPass(g, DARK) && mustPass(g, LIGHT));
}

/** counts mirrors board.go's `Board.Scores` — disc counts as `[dark, light]`. */
export function counts(g: Game): [number, number] {
  let dark = 0;
  let light = 0;
  for (const cell of g.board) {
    if (cell === DARK) dark++;
    else if (cell === LIGHT) light++;
  }
  return [dark, light];
}

/** Outcome of a finished (or still-ongoing) game. There is no Go equivalent — revgame only exposes disc counts (`Scores`) and an `IsCompleted` bool; this is the natural Ongoing/Dark/Light/Draw classification a session layer needs on top of that. */
export const enum Outcome {
  Ongoing = 0,
  DarkWins = 1,
  LightWins = 2,
  Draw = 3,
}

/** outcome classifies the game by disc count once it is over (Ongoing otherwise). Most-discs wins; equal discs is a draw, per game-kit/docs/DESIGN.md §Reversi ("Classic: ... most discs wins (draws possible)"). */
export function outcome(g: Game): Outcome {
  if (!isOver(g)) return Outcome.Ongoing;
  const [dark, light] = counts(g);
  if (dark > light) return Outcome.DarkWins;
  if (light > dark) return Outcome.LightWins;
  return Outcome.Draw;
}

/** CellOutOfRangeError: `cell` is not a valid board index (0..63). Go's equivalent is an off-board `Address` panic inside `getDisksToFlip` (board_test.go's `TestBoard_getDisksToFlip_Panics`) — reachable there only via direct internal calls. Here `cell` is a plain number coming from a public API, so an out-of-range value is a normal (if unlikely) caller mistake, not an invariant violation, and gets a catchable error instead of a panic. */
export class CellOutOfRangeError extends Error {
  constructor(cell: number) {
    super(`revplay: cell ${cell} is out of range (must be 0..${BOARD_CELLS - 1})`);
    this.name = "CellOutOfRangeError";
  }
}

/** AlreadyOccupiedError mirrors board.go's `ErrAlreadyOccupied`. */
export class AlreadyOccupiedError extends Error {
  constructor(cell: number) {
    super(`revplay: cell ${cell} is already occupied`);
    this.name = "AlreadyOccupiedError";
  }
}

/** NotValidMoveError mirrors board.go's `ErrNotValidMove` (the move flanks no opponent disc in any direction). */
export class NotValidMoveError extends Error {
  constructor(cell: number) {
    super(`revplay: cell ${cell} is not a valid move (flips no discs)`);
    this.name = "NotValidMoveError";
  }
}

/**
 * applyMove mirrors board.go's `Board.MakeMove`: validate, place `player`'s
 * disc at `cell`, flip every disc `computeFlips` finds, and return the new
 * game plus the list of flipped cells. Pure — `g` is never mutated; a
 * rejected move throws and leaves `g` untouched.
 *
 * Error order mirrors Go's: occupancy is checked first (`AlreadyOccupiedError`
 * / Go's `ErrAlreadyOccupied`), then — only for an empty cell — whether the
 * move flips anything at all (`NotValidMoveError` / Go's `ErrNotValidMove`).
 */
export function applyMove(g: Game, player: Player, cell: number): { game: Game; flipped: number[] } {
  if (!Number.isInteger(cell) || cell < 0 || cell >= BOARD_CELLS) {
    throw new CellOutOfRangeError(cell);
  }
  if (g.board[cell] !== null) {
    throw new AlreadyOccupiedError(cell);
  }
  const flipped = computeFlips(g.board, cell, player);
  if (flipped.length === 0) {
    throw new NotValidMoveError(cell);
  }

  const board = g.board.slice() as Disk[];
  board[cell] = player;
  for (const f of flipped) board[f] = player;
  return { game: { board }, flipped };
}
