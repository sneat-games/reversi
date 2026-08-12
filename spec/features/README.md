---
format: https://specscore.md/features-index-specification
---

# Features

Feature specifications for this project.

## Index

| Feature | Status | Description |
|---------|--------|-------------|
| [Telegram Reversi bot (vs AI, state in callback data)](telegram-reversi-bot/README.md) | Draft | Play **Reversi** (Othello) against a built-in robotic opponent inside a single |
| [Web game rules (Classic + Bidding)](web-game-rules/README.md) | Implementing | Rules-of-record spec for the reversi.sneat.games web build: Classic (standard Reversi, TS engine mirrors server-go/revgame fixture-for-fixture) and Bidding (both players commit bid+cell against the same position; first-price-transfer auction) variants, per game-kit/docs/DESIGN.md §Reversi. |
| [Web App](web-app/README.md) | Implementing | The Astro + TypeScript web application for reversi.sneat.games: menu, bespoke SVG board (legal-move hints, capture preview, cascading flips), classic and bidding sessions vs Bot and vs Friend, theming, PWA, standings preview and cross-promotion — the UI/session layer built on the web-game-rules engine and @sneat/game-kit. |

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/features-index-specification*
