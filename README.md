# Cubic

<p align="center">
  <img src="docs/readme/title.png" alt="The Cubic title screen: the word CUBIC over a floating pixel-art cube in the sky, with a PLAY button" width="720">
</p>

Cubic is a two-player co-op game where one player walks the outside of a cube and the other is trapped inside, and you solve puzzles together by talking each other through the walls.

**Play:** [playcubic.tech](https://playcubic.tech) (backup: [cubic-tau.vercel.app](https://cubic-tau.vercel.app))

Built by team Turtles at StormHacks 2026.

## How it works

A cube has six faces. The OUTSIDE player walks on the outer side of them. The INSIDE player walks on the inner side of the same six walls. Walk off the edge of a face and you cross onto the next one.

<p align="center">
  <img src="docs/readme/side-select.png" alt="The side select screen: OUTSIDE on a grass top with a green turtle, INSIDE in a dark room with a blue turtle, and a room code at the top" width="720">
</p>

- You cannot see each other's screen. One side holds the clue and the other holds the controls, so neither of you can solve a puzzle alone.
- The inside is mirrored. The inside player sees every wall from behind, so left and right are flipped.
- Voice gets quieter the further apart you are on the cube. Same face is loud, a neighbouring face is quiet, the opposite face is silent. There is also a text chat.

<table>
  <tr>
    <td align="center"><img src="docs/readme/game-outside.png" alt="The outside view of face 1: a grass field with bushes, rocks, ponds and orange tiles, the cube HUD, voice controls and chat on the right" width="400"></td>
    <td align="center"><img src="docs/readme/game-inside.png" alt="The inside view of face 5, the laser room: a dark tile floor with symbols, a blue turtle, the cube HUD, voice controls and chat on the right" width="400"></td>
  </tr>
  <tr>
    <td align="center">The outside player on the grass of face 1</td>
    <td align="center">The inside player in the laser room of face 5</td>
  </tr>
</table>

## Game modes

<p align="center">
  <img src="docs/readme/mode.png" alt="The Select Mode screen with CREATE LOBBY, JOIN LOBBY and PLAY SOLO buttons beside a turning cube" width="640">
</p>

- **Create Lobby** makes a room and shows a room code to share.
- **Join Lobby** asks for the room code from your friend.
- **Play Solo** lets you pick a side. An AI partner takes the other one. She chats back and has two voices to choose from in Settings: Jessica and Wizard.

## The six faces

- **Face 1, Grass:** one player reads a number laid out in the grass, the other types it on a keypad.
- **Face 2, Desert:** count what you can see outside, then work out the vault code inside.
- **Face 3, Snow:** describe a symbol carved in the snow so the other player can rebuild it on the floor tiles.
- **Face 4, Forest:** plant five flowers in the right pots. The inside player sees which pot is which.
- **Face 5, Rooftop:** call out the order the symbols light up, and the other player presses them in that order.
- **Face 6, Cave:** aim two mirrors so the laser burns the crate, then read out the safe path across the lava.

Some puzzles hand items to others (a battery, the laser, a flower). Every game uses a new random seed, so codes and orders change each time. Solve all six and the cube unfolds.

<p align="center">
  <img src="docs/readme/ending.png" alt="The end screen: PASSED CUBE 1, with the time, the strike count, MAIN MENU and PLAY AGAIN buttons above the unfolded cube" width="640">
</p>

## Controls

- Move: W A S D or the arrow keys
- Use / pick up: E
- Drop: Q
- Push to talk: V (hold)
- Chat: Enter to open and send, Esc to close
- Cube map: Tab (hold)
- Pause: Esc

Keys can be rebound in Settings. Gamepads and touch screens work too.

## Built with

- TypeScript
- Node.js and Socket.io (game server)
- Phaser 4 and Vite (game client)
- WebRTC (voice chat)
- Google Gemini (AI partner chat)
- ElevenLabs (AI partner voices)
- Vercel and Render (hosting)

## Run it locally

You need Node.js 22.12 or newer.

```bash
npm install
npm run dev
```

This starts the server on port 3001 and the client on port 5173. Open http://localhost:5173. To try two players, open the app in two separate browser windows.

The game runs without any API key. The environment variables below are all optional locally. Copy `server/.env.example` to `server/.env` and `client/.env.example` to `client/.env.local`. The other variables are listed in those two files.

- `CLIENT_ORIGIN` (server): allowed browser origins, comma-separated. Needed when you host the client elsewhere.
- `GEMINI_API_KEY` (server): turns on Gemini chat for the AI partner.
- `ELEVENLABS_API_KEY` (server): turns on live ElevenLabs speech.
- `ELEVENLABS_VOICE_ID` (server): the partner's voice.
- `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` (server): a TURN relay for voice on strict networks. Set all three or none.
- `VITE_SERVER_URL` (client): the game server URL. Leave it unset locally. The Vercel build needs it.

Other commands: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

## Credits

- Team Turtles, StormHacks 2026.
- Music by Kevin MacLeod ([incompetech.com](https://incompetech.com)), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Details in [CREDITS.md](CREDITS.md).
- AI voices by [ElevenLabs](https://elevenlabs.io).
- Turtle sprites by our team.
