# Reversi — Web

Client-only Astro + TypeScript web build of Reversi (Othello), packaged for
`reversi.sneat.games`, CrazyGames, and itch.io. No server-side game state:
vs-Bot plays entirely in the browser (offline-capable); vs-Friend uses the
shared `webrtc-relay` signaling worker (no DB, no auth, no game state) plus a
WebRTC DataChannel. Built on [`@sneat/game-kit`](https://github.com/sneat-games/game-kit)
— see its `docs/DESIGN.md` §Reversi for the cross-game architecture, and
`spec/features/` in this repo for the rules and web-app specs.

The Go package under `server-go/` (the Telegram bot's engine) remains the
**rule of record**: `src/engine/revplay.ts` mirrors `server-go/revgame`
fixture-for-fixture, with `revplay.test.ts`'s describe blocks named after the
Go test functions they port, so a Go rule change trips a TypeScript failure.

## Local development

```sh
npm install
npm run dev          # http://localhost:4321
npm run test         # vitest — engine, bot, and the UI (jsdom)
npm run typecheck    # astro check + tsc (app + host-worker)
npm run lint         # eslint flat config
npm run build        # static dist/ — zippable for CrazyGames/itch.io
npm run e2e          # Playwright — builds, serves, and runs the local relay
```

`npm run e2e` starts two local servers itself (see `playwright.config.ts`): a
production-equivalent build served by `astro preview` on **port 4795** (a
port specific to this repo — several sibling kit games all answer on Astro's
default 4321, and a shared port silently tests the wrong app), and
game-kit's `test-relay.mjs` on 8787 (the port the kit's `defaultRelayBase()`
uses for any localhost origin), so vs-Friend journeys never touch the
production relay.

## Modes

- **Classic** — standard Othello. Dark moves first; a player with no legal
  move **passes**, announced unmissably on both sides (the passing player
  gets a Pass button that is the only enabled control in the match area).
  Two passes in a row, or a full board, end the game; most discs wins, and
  draws are real.
- **Bidding** — every contested round both sides secretly commit
  `{bid, cell}` against the SAME position; the higher bid (first-price
  TRANSFER, alternating tie-break — `@sneat/game-kit`'s `auction/`) wins the
  round and places, and the loser's cell is discarded. **The auction runs
  only when both players have a legal move**: when exactly one player can
  move they move for FREE (no auction, nothing paid — there is nothing to
  compete for), and when neither can, the match ends. Discs decide the
  winner; the budget is only the control economy.
- **vs Bot** — `src/bot/bot.ts` (a TS port of `revgame`'s corner-first greedy
  `SimpleAI`, plus BTTT-style restrained bid sizing) plays the other side,
  entirely client-side.
- **vs Friend** — the host reserves a room and shares
  `https://reversi.sneat.games/#room=<code>`; the guest's `#room=` link skips
  the menu entirely and learns the match's variant from the host's `hello`
  message (`src/ui/vs-friend.ts`) — see `game-kit/docs/DESIGN.md`'s PvP
  protocol v1.

## Board rendering

`src/ui/board.ts` is a bespoke SVG board on `revplay.ts`'s row-major cell
indexing, built from theme tokens rather than green felt: an accent-tinted
plane, hairline grid, and the four standard star points. What it adds over a
plain board:

- **Legal-move hints** — a translucent dot on every cell the hinted player
  may play (the side to move in classic; the LOCAL player in bidding, where
  both sides commit against the same position).
- **Capture preview** — hovering or focusing a legal cell ghosts the disc AND
  rings every disc the move would flip. Reversi's whole skill is seeing the
  flips before committing.
- **Cascading flip** — each flipped disc turns through its rim colour,
  staggered by its distance from the placed disc (~40 ms per step, ~180 ms
  per disc), so a capture visibly radiates along its ray. Pure CSS.
- **Drop-in + last-move ring** on the disc just played, and a **disc-count
  race bar** at the top of the score card that animates the swing on every
  move.
- **End of match** — the board dims and one soft sweep crosses it.

Every cell is keyboard-reachable with a real accessible name
(`"d3 — flips 3 discs"`), and all motion is gated behind
`prefers-reduced-motion`.

## Theme

Light and dark themes, following the system preference by default, with a
toggle in the site header (`@sneat/game-kit`'s `createThemeToggle()`). A
pre-paint `<script>` in `Layout.astro` applies any stored choice before first
paint, so there is no flash of the wrong theme. Reversi's accent is green
(`--accent: #16a34a`). The discs are near-black and near-ivory: this game
**overrides the kit's `--p1`/`--p2`** so the score card, race bar and game
log bars match the discs exactly, and every disc/chip/bar carries a visible
rim, because at those two ends of the ramp contrast cannot come from hue.

## PWA / offline

`@vite-pwa/astro` precaches the app shell. The service worker is registered
manually by `main.ts` (not the plugin's auto-injected script) and only on
`*.sneat.games` — never under `astro dev`, never on a local preview (a
precached asset manifest would keep serving the previous build), and never
inside a CrazyGames/itch.io iframe. Because vs-Bot needs no network at all,
it stays fully playable offline once installed.

## Deploy

| Surface | Worker/target | Domain |
|---|---|---|
| Static game | `web/host-worker/` (`reversi-game`) | `reversi.sneat.games` |
| WebRTC signaling | shared `sneat-games/webrtc-relay` | `webrtc.sneat.games` |
| CrazyGames build | `web/dist/` zip via Developer Portal | crazygames.com |
| itch.io build | `web/dist/` zip via itch.io HTML project | *.itch.io |

```sh
npm run host:deploy     # reversi.sneat.games (requires `wrangler login`)
```

This app does **not** run its own signaling worker — every kit game shares
one relay deployment (`sneat-games/webrtc-relay`), namespaced by `gameId`
("reversi").

### CrazyGames + itch.io upload

1. `npm run build` (the postbuild pass rewrites Astro's root-absolute asset
   URLs to relative ones, so the bundle plays from any subpath)
2. `cd dist && zip -r ../reversi.zip . && cd ..`
3. **CrazyGames:** upload `reversi.zip` through the
   [Developer Portal](https://developer.crazygames.com/games); use the
   Preview tool to validate the SDK + Play-with-Friends surface (the SDK only
   activates on a CrazyGames domain/iframe — see `@sneat/game-kit`'s
   `crazygames/sdk.ts`). Add `?cgsdk=1` to a `reversi.sneat.games` URL to
   exercise the SDK path off-platform.
4. **itch.io:** create an HTML project, upload `reversi.zip`, and check "This
   file will be played in the browser". No further configuration needed — the
   build uses only relative asset paths and the WebRTC relay defaults to the
   production `webrtc.sneat.games` on any non-localhost origin.

## Repository layout

```
web/
├── src/
│   ├── engine/revplay.ts     port of server-go/revgame — the rules
│   ├── bot/bot.ts            SimpleAI port + bidding bid sizing
│   ├── ui/
│   │   ├── board.ts              SVG board: hints, capture preview, flips
│   │   ├── menu.ts               mode/variant menu (wraps kit's renderMenu)
│   │   ├── score-card.ts         disc counts + the race bar
│   │   ├── turn-status-card.ts   classic mode's turn/clock card
│   │   ├── countdown-bar.ts      the shared self-enforced-deadline bar
│   │   ├── pass-banner.ts        forced pass + bidding's free-move notice
│   │   ├── ask-cell.ts           classic-mode "click a cell" plumbing
│   │   ├── ask-bid-move.ts       bidding-mode bid+cell plumbing
│   │   ├── match-over.ts         end-of-match banner (win/loss/draw)
│   │   ├── rev-format.ts         board notation + copy helpers
│   │   ├── standings.ts          header trophy — real local W/L/D + mock ladder
│   │   ├── vs-bot-classic.ts / vs-bot-bidding.ts
│   │   ├── vs-friend.ts          connect + hello/hello-ack handshake
│   │   ├── friend-common.ts      peer-gone, rematch, end-of-match controls
│   │   └── friend-classic.ts / friend-bidding.ts   PvP turn loops
│   ├── styles/board.css      board + card styles (kit theme tokens only)
│   ├── layouts/Layout.astro
│   ├── pages/index.astro
│   └── main.ts               bootstrap: invite-link / menu loop
├── host-worker/              CF Worker serving dist/ at reversi.sneat.games
├── e2e/                      Playwright specs
├── scripts/relativize-dist.mjs   postbuild: root-absolute -> relative URLs
├── astro.config.mjs          @vite-pwa/astro integration
├── playwright.config.ts
├── tsconfig.json / vitest.config.ts / eslint.config.mjs
```

### `@sneat/game-kit` dependency

Everything cross-game — the auction core, turn clocks, WebRTC PvP transport
and commit-reveal protocol, the CrazyGames SDK wrapper, and the whole design
system (theming, menu, bid panel, balances, score card, game log, match
shell, cross-promotion footer) — comes from `@sneat/game-kit`
(`github:sneat-games/game-kit#v0.1.2`), pinned as a normal `dependencies`
entry. The kit is public and MIT-licensed. Only `revplay.ts` (the engine),
`bot.ts` (the bot), and this game's own board/session/menu code are
Reversi-specific.
