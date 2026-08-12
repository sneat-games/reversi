# Reversi game (aka Othello)

Reversi in your browser and in your messenger. Play a friend or practice
against the bot.

  - **Web**: [reversi.sneat.games](https://reversi.sneat.games) — classic
    Othello and a hidden-bid **bidding** variant, vs Bot (offline-capable) or
    vs a friend over WebRTC. Source in [`web/`](web/README.md).
  - **Telegram**: [@ReversiGameBot](https://t.me/ReversiGameBot) — source in
    `server-go/`.

Both surfaces share one set of rules: `server-go/revgame` is the rule of
record, and `web/src/engine/revplay.ts` mirrors it fixture-for-fixture.

  Built using:
   - [`@sneat/game-kit`](https://github.com/sneat-games/game-kit) — the shared
     web kit (auction core, WebRTC PvP, design system)
   - [Strongo Bots Framework](https://github.com/strongo/bots-framework)
   - [Strongo Database Abstraction Layer](https://github.com/strongo/db)


<!-- dev-approach:v1 -->
## Our approach to development

We build with our own tooling:

- **[SpecScore](https://specscore.md)** — specify requirements as `SpecScore.md` artifacts
- **[SpecStudio](https://specscore.studio)** — author & manage specs across their lifecycle
- **[inGitDB](https://ingitdb.com)** — store structured data in Git where applicable
- **[DALgo](https://dalgo.io)** — data access layer for Go
- **[cover100.dev](https://cover100.dev)** — drive toward 100% test coverage
- **[DataTug](https://datatug.io)** — query & explore data
<!-- /dev-approach -->

## Contributions wanted!

We would be glad to accept pull requests for:
 - Bringing game to Viber
 - Bringing game to other messengers
 - Any bug fixes amd/or improvements
