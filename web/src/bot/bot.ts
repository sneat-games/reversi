// Bot strategy for Reversi vs-bot play (classic move-picking), plus bid-
// sizing helpers for the bidding variant described in
// game-kit/docs/DESIGN.md §Reversi.
//
// pickMove is a faithful TypeScript port of server-go/revgame/ai.go's
// SimpleAI.GetMove: prefer any corner capture over all else (a corner disc
// can never be flipped again, so it anchors permanent territory); among the
// remaining candidates (corner moves if any exist, otherwise every legal
// move), pick whichever leaves the mover with the highest own disc COUNT
// immediately after the move — not a positional/strategic evaluation, just
// raw post-move score, exactly as ai.go computes it via board.Score(player).
// Ties are broken uniformly at random. See ai_test.go for the fixtures this
// mirrors, and bot.test.ts for where each one lands.
//
// isDecisive/pickBid are NEW — revgame has no bidding variant, only the
// classic sequential-turn game. They exist so a later wave's bidding
// session layer can size bids the same restrained way BTTT's own bot does
// (bidding-tictactoe/web/src/bot/bot.ts's pickBid): under a first-price-
// TRANSFER auction (the winner's bid is paid to the LOSER, not burned),
// bidding your whole budget to win one placement just gifts it to the
// opponent — so sizing stays conservative except when the round decides the
// match, in which case it's worth buying outright.

import {
  type Game,
  type Player,
  DARK,
  legalMoves,
  applyMove,
  counts,
  isOver,
  otherPlayer,
  rowOf,
  colOf,
} from "../engine/revplay";

function isCorner(cell: number): boolean {
  const row = rowOf(cell);
  const col = colOf(cell);
  return (row === 0 || row === 7) && (col === 0 || col === 7);
}

/**
 * bestMove mirrors ai.go's inline `bestMove` closure: among `candidates`
 * (assumed non-empty), return whichever leaves `player` with the highest own
 * disc count after playing it, breaking ties uniformly at random.
 */
function bestMove(g: Game, player: Player, candidates: number[]): number {
  if (candidates.length === 1) return candidates[0];

  // Go's bestScore starts at the zero value (0) and relies on every real
  // post-move score being > 0 to seed bestMoves on the first candidate; we
  // mirror that rather than using -Infinity, since it's exactly what ai.go
  // does and a post-move score is always >= 3 in this game anyway (you can
  // never end a legal move with fewer discs than you started the game with).
  let bestScore = 0;
  let bestMoves: number[] = [];
  for (const move of candidates) {
    const { game: next } = applyMove(g, player, move);
    const [dark, light] = counts(next);
    const score = player === DARK ? dark : light;
    if (score === bestScore) {
      bestMoves.push(move);
    } else if (score > bestScore) {
      bestScore = score;
      bestMoves = [move];
    }
  }
  if (bestMoves.length === 1) return bestMoves[0];
  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

/**
 * pickMove chooses SimpleAI's move for `player` on `g`: any corner beats
 * every non-corner move; otherwise take whichever legal move maximises
 * `player`'s own disc count afterwards, breaking ties at random.
 *
 * Throws if `player` has no legal move — callers must check
 * `mustPass`/`legalMoves` first. ai.go's GetMove has the exact same
 * precondition; its own guard against the empty-moves case is commented out
 * in ai.go ("if len(validMoves) == 0 { return }"), relying on the same
 * caller contract. We make that contract explicit with a thrown error
 * instead of silently returning a meaningless zero-value move.
 */
export function pickMove(g: Game, player: Player): number {
  const moves = legalMoves(g, player);
  if (moves.length === 0) {
    throw new Error("revplay bot: pickMove called with no legal moves");
  }

  const cornerMoves = moves.filter(isCorner);
  if (cornerMoves.length > 0) return bestMove(g, player, cornerMoves);
  return bestMove(g, player, moves);
}

/**
 * isDecisive reports whether this round is likely to swing the match:
 * either side can take a corner right now (corners are permanent and often
 * decide close endgames), OR the game can end within this single round —
 * i.e. some legal move available to EITHER player would leave `isOver()`
 * true immediately after it. There is no Go equivalent (revgame's classic
 * mode has no auction, so there's no "how much to bid" question); this
 * shapes bid sizing for a later wave's bidding session layer.
 */
export function isDecisive(g: Game, player: Player): boolean {
  const opponent = otherPlayer(player);
  const myMoves = legalMoves(g, player);
  const oppMoves = legalMoves(g, opponent);

  if (myMoves.some(isCorner) || oppMoves.some(isCorner)) return true;

  const someMoveEndsGame = (mover: Player, moves: number[]): boolean =>
    moves.some((cell) => isOver(applyMove(g, mover, cell).game));

  return someMoveEndsGame(player, myMoves) || someMoveEndsGame(opponent, oppMoves);
}

export interface BidInputs {
  /** The bot's own remaining bid budget. */
  budgetRemaining: number;
  /** The opponent's remaining bid budget (public information — what decides whether a decisive round can be bought outright). */
  opponentBudget: number;
  /** Whether this round is a match-swinging one; see isDecisive. */
  decisive: boolean;
}

/**
 * pickBid sizes a bid, reusing BTTT's restrained shape
 * (bidding-tictactoe/web/src/bot/bot.ts's pickBid) adapted to Reversi's
 * decisiveness signal:
 *   - Broke (budgetRemaining <= 0): bid 0.
 *   - Decisive AND strictly richer than the opponent: bid `opponentBudget +
 *     1` — the cheapest stake nobody can outbid. Being strictly richer over
 *     integers guarantees `budgetRemaining >= opponentBudget + 1`, so this
 *     never exceeds what's left.
 *   - Decisive but not affordably richer: bid ~1/3 of what's left — it
 *     matters, but going all-in would gift the budget to the opponent under
 *     the first-price-transfer rule.
 *   - Ordinary round: a small ~1/6 slice with +-1 jitter, to keep play from
 *     being fully predictable without over-committing early.
 */
export function pickBid({ budgetRemaining, opponentBudget, decisive }: BidInputs): number {
  if (budgetRemaining <= 0) return 0;

  if (decisive) {
    if (budgetRemaining > opponentBudget) {
      return opponentBudget + 1;
    }
    return Math.max(1, Math.floor(budgetRemaining / 3));
  }

  const base = Math.max(1, Math.floor(budgetRemaining / 6));
  const jitter = Math.floor(Math.random() * 3) - 1; // -1..+1
  return Math.max(0, Math.min(budgetRemaining, base + jitter));
}

// Exposed for direct unit testing of the corner predicate, the same way
// isInCorner is exercised indirectly through ai_test.go's fixtures in Go.
export const __test = { isCorner, bestMove };
