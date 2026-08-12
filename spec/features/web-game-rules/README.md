---
format: https://specscore.md/feature-specification
status: Implementing
---

# Feature: Web game rules (Classic + Bidding)

> [SpecScore.**Studio**](https://specscore.studio): | [Explore](https://specscore.studio/app/github.com/sneat-games/reversi/spec/features/web-game-rules?op=explore) | [Edit](https://specscore.studio/app/github.com/sneat-games/reversi/spec/features/web-game-rules?op=edit) | [Ask question](https://specscore.studio/app/github.com/sneat-games/reversi/spec/features/web-game-rules?op=ask) | [Request change](https://specscore.studio/app/github.com/sneat-games/reversi/spec/features/web-game-rules?op=request-change) |
**Status:** Implementing
**Source Ideas:** —

## Summary

Rules-of-record spec for the reversi.sneat.games web build: Classic (standard Reversi, TS engine mirrors server-go/revgame fixture-for-fixture) and Bidding (both players commit bid+cell against the same position; first-price-transfer auction) variants, per game-kit/docs/DESIGN.md §Reversi.

## Problem

Every Sneat Games game's rules must be defined as a SpecScore spec, but until now Reversi's rules existed only as Go source: `server-go/revgame` (the engine, covered by `spec/features/telegram-reversi-bot`, which specs the *Telegram bot* around it) and, new for the web build, `game-kit/docs/DESIGN.md` §Reversi's prose description of a **Bidding** variant that has no Go implementation and no spec artifact at all. `spec/features/telegram-reversi-bot` specs the Telegram delivery surface, not the rules in isolation, and says nothing about Bidding. This feature is the rules-of-record for the `reversi.sneat.games` web build specifically: it specs Classic (the same rules as `revgame`, ported — not reimplemented — to TypeScript) and Bidding (new, web-only) as one document so both variants' rules live somewhere other than source code and test fixtures.

## Behavior

### Classic

Standard 8×8 Reversi/Othello. The board is 64 cells; a move places a disc on an empty cell and flips every opponent disc it flanks — in any of the 8 directions independently — between the placed disc and an existing disc of the mover's own colour; a direction where the opponent run is not capped by the mover's own colour before running off the board (or into an empty cell) flips nothing in that direction. A move that flips zero discs in every direction, or that targets an occupied cell, is illegal. A player with no legal move passes automatically rather than stalling the game. The game ends when neither player has a legal move, or the board is full; the player with more discs wins, and an equal split is a draw.

The TS engine (`web/src/engine/revplay.ts`) mirrors `server-go/revgame` fixture-for-fixture as the rule-of-record for this variant: `web/src/engine/revplay.test.ts`'s describe blocks are named after the Go test functions (`board_test.go`, `board_more_test.go`, `moves_exported_test.go`) they port, so a Go rule change trips a TS failure. One deliberate difference from `revgame`: the Go engine infers whose turn it is from the last-played cell (`Board.NextPlayer`); the TS port instead takes the player explicitly on every call, because that implicit inference doesn't generalise to Bidding below, where there is no fixed "next player" at all.

### Bidding

Both players simultaneously commit a **bid** (staked from a per-match budget) and a target **cell**, against the identical current board position — this is not alternating turns. The higher bid wins the round; equal bids are decided by an **alternating tie-break** so neither side keeps a permanent advantage. The auction is **first-price-TRANSFER**: the winner pays their bid to the LOSER (the loser's budget grows by the winning bid), so the total budget across both players is conserved across the whole match — the same conservation rule Bidding Tic-Tac-Toe's `btttplay` uses, applied here to Reversi. The auction winner's committed move is placed (both players committed against the same position, so the winner's move is always still legal at resolution time); the loser's committed move is discarded entirely, unplayed and unpaid-for beyond their own bid.

**Pass handling is asymmetric with Classic, and this is the one place Bidding's rules diverge from a straight "run an auction every round":** the auction only runs when BOTH players have at least one legal move. When exactly one player can move, that player moves for free — no auction, no payment, because there is nothing to compete for. When neither player can move, the game ends. Discs decide the winner exactly as in Classic (most discs wins, draws possible); budgets are only the control economy that decides *which* moves happen, never the win condition.

### Bot

The bot (`web/src/bot/bot.ts`) is a faithful TS port of `revgame`'s `SimpleAI`: any legal corner move beats every non-corner move (a corner disc can never be flipped again); among the remaining candidates, it plays whichever move maximises its own disc count immediately after playing it, breaking ties uniformly at random. `bot.test.ts` mirrors `ai_test.go`'s fixtures where portable. For Bidding, `isDecisive` flags a round as match-swinging (a corner is takeable by either side this round, or the round can end the game outright) and `pickBid` sizes the bid accordingly, reusing Bidding Tic-Tac-Toe's restrained shape (`bidding-tictactoe/web/src/bot/bot.ts`): decisive and strictly richer than the opponent bids `opponentBudget + 1` (the cheapest stake nobody can outbid); decisive otherwise bids ~1/3 of what's left; an ordinary round bids ~1/6 with small jitter; a broke bot bids 0.

## Acceptance Criteria

- `web-game-rules#ac:go-parity`: `web/src/engine/revplay.ts` and `web/src/bot/bot.ts` reproduce every rule-relevant fixture from `server-go/revgame`'s test suite (`board_test.go`, `board_more_test.go`, `moves_exported_test.go`, `ai_test.go` where portable) with describe blocks in `revplay.test.ts`/`bot.test.ts` named after the Go test functions they mirror, so a Go rule change trips a TS failure.
- `web-game-rules#ac:classic-flip-in-8-directions`: a legal move flips every opponent disc flanked in any of the 8 directions between the placed disc and an existing disc of the mover's own colour; a run that reaches an empty cell or the board edge without a capping disc of the mover's colour flips nothing in that direction. Verified by `revplay.test.ts`'s "flip search — all 8 directions" and "TestBoard_getDisksToFlip_OpponentRunToEdge".
- `web-game-rules#ac:move-validation-errors`: a move onto an occupied cell, and a move that flips zero discs, are both rejected without mutating the board, as two distinguishable error types (`AlreadyOccupiedError`, `NotValidMoveError`). Verified by `revplay.test.ts`'s "TestBoard_MakeMove_OccupiedCell" and the illegal-first-step case in "TestBoard_MakeMove".
- `web-game-rules#ac:pass-handling`: a player with no legal move passes automatically in Classic — `mustPass`/`isOver` report this directly from the board position, with no implicit "whose turn" state required. Verified by `revplay.test.ts`'s "TestBoard_NextPlayer_Branches (pass detection...)".
- `web-game-rules#ac:classic-endgame-outcome`: the game ends when neither player has a legal move, or the board is full; the player with more discs wins; an equal split is a draw. Verified by `revplay.test.ts`'s "TestBoard_IsCompleted" and "endgame outcome: Dark/Light/Draw by disc count".
- `web-game-rules#ac:bidding-one-sided-free-move`: the Bidding auction runs only when both players have a legal move; when exactly one player can move, they move for free (no auction, no payment); when neither can move, the game ends. (Session-layer behaviour — the engine's `legalMoves`/`mustPass` on both players give the session layer everything it needs to implement this; there is no dedicated auction function in this Wave.)
- `web-game-rules#ac:bidding-transfer-conservation`: the Bidding auction is first-price-TRANSFER — the winner pays their bid to the loser, so total budget across both players is conserved across the match; the winner's committed move is placed, the loser's is discarded. (Session-layer behaviour, mirroring `btttplay`'s `resolveTurn`/`TurnResult` conservation invariant, asserted for Bidding Tic-Tac-Toe by `btttplay.test.ts`'s "resolveTurn higher-bid wins, places and transfers" / "resolveTurn tie-break alternates".)
- `web-game-rules#ac:bidding-tie-break`: equal bids in the Bidding auction are decided by an alternating tie-break, so neither side keeps a permanent tie advantage. (Session-layer behaviour, mirroring `btttplay`'s `tieToX` alternation.)
- `web-game-rules#ac:bot-corner-preference`: the bot's `pickMove` always prefers any legal corner move over every non-corner move, and among equal-post-move-score candidates breaks ties randomly. Verified by `bot.test.ts`'s "TestSimpleAI_GetMove_PrefersCorner", "TestSimpleAI_GetMove_TieBreak", and "TestSimpleAI_GetMove".
- `web-game-rules#ac:bot-bid-sizing`: the bot's `isDecisive`/`pickBid` size Bidding bids per the restrained shape — decisive and strictly richer bids `opponentBudget + 1`; decisive otherwise bids ~1/3 of what's left; an ordinary round bids ~1/6 with jitter; broke bids 0. Verified by `bot.test.ts`'s "isDecisive" and "pickBid" describe blocks.

Two ACs above (`#ac:bidding-one-sided-free-move`, `#ac:bidding-transfer-conservation`, and `#ac:bidding-tie-break`) describe **session-layer** behaviour that a later wave implements on top of this Wave's engine — this Wave ships the engine primitives (`legalMoves`, `mustPass`, `applyMove`) those rules are built from, plus the bot's `isDecisive`/`pickBid` sizing helpers, but not a `resolveBiddingRound`-equivalent function itself (there is no such function in `server-go/revgame` to port from — Bidding has no Go implementation). They are recorded here now, rather than deferred to a later spec, so the rule is fixed before the session layer is built against it.

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/feature-specification*
