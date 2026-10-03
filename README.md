# Cubic

StormHacks 2026 project: two players, one cube. One's outside, one's trapped inside.

Each player sees only their own side of the same six walls. The cube's geometry is the
game: corners are 270 degrees, walking a loop around one turns you 90 degrees, and the
inside is mirrored. You solve it by talking through the wall.

## Run

Needs Node 22.12+.

```
npm install
npm run dev        # server on :3001, client on http://localhost:5173
npm test           # unit tests
npm run typecheck && npm run lint
```

Teammates: read [CLAUDE.md](CLAUDE.md) first, then the README in your folder:
[puzzles](shared/src/puzzles/README.md), [maps](maps/README.md),
[assets](client/public/assets/README.md), [ui](client/src/ui/README.md),
[scenes](client/src/scenes/README.md).

UI without a server: `http://localhost:5173/?mock=lobby` or `?mock=game`.
