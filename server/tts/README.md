# server/tts: the AI partner's voice banks

Committed MP3 clips of everything the scripted AI partner can say, so a solo game never
buys a scripted line at run time. Code: `server/src/ai/tts.ts` (lookup), `bank.ts` and
`server/scripts/ttsBank.ts` (the build), `wire.ts` (which voice a room speaks with).

## Voices and folders

The player picks the voice in Settings > SOUND > "Partner voice". The list is `AI_VOICES`
in `shared/src/aiVoices.ts`.

| Voice (key) | ElevenLabs voice id | Folder |
| --- | --- | --- |
| Jessica (`jessica`), the default | `r1KmysJdVYZjJCm4mL3b` | `server/tts/bank` |
| Wizard (`wizard`) | `JoYo65swyP8hH6fVMeTO` | `server/tts/bank-wizard` |

- Every bank holds the same clips: the fixed lines of the active persona
  (`server/src/ai/scripted.ts`) and every relay vocabulary piece
  (`shared/src/bot/vocab.ts`). Same model (`ELEVENLABS_BANK_MODEL`, default `eleven_v4`),
  same silence trim.
- A clip is `sha256(voice id \n bank model \n exact text)[:24].mp3`; `index.json` beside
  the clips says which file is which line.
- `server/tts/bank` also still holds the 82 clips of the very first voice. They no longer
  resolve; they are kept as they are.
- `bank-lines.txt` is not read by anything (see its header).

## At run time

- The client sends the voice KEY (`ai:voice`), never an id. The server checks it against
  `AI_VOICES` and ignores anything else. A room that never chose is on the default voice.
- Only the chosen voice is used: its clips are read from disk when first asked for and kept
  in memory; the other bank is not read until a player picks that voice.
- The chosen voice is used for banked lines, chained word clips (relay answers) and live
  lines (Gemini's own, with the chosen voice's id and the same caps as before).
- **Missing clips fail soft.** A voice whose folder or clip is not there (the Wizard bank
  before it is bought) falls to the next step: the disk cache, a live line where that is
  allowed, else the browser voice. A relay answer with one missing piece is read by the
  browser as a whole.
- A two-player game has no AI partner: nothing here is loaded or called.

## ELEVENLABS_VOICE_ID

It replaces the id behind the DEFAULT voice (the "Jessica" slot) only, as before the
picker: with another id the clips in `server/tts/bank` no longer resolve for that voice
until the bank is built again with it. It does not change the Wizard, and it cannot add a
voice: the picker's voices are the list in `shared/src/aiVoices.ts`.

## Building a bank

```
npm run tts:bank -w server                          # dry run, default voice
npm run tts:bank -w server -- --voice wizard        # dry run, Wizard
npm run tts:bank -w server -- --voice wizard --buy  # buys what is missing (needs ELEVENLABS_API_KEY in server/.env)
```

- The dry run is the default. It makes no network call and writes nothing. It prints every
  missing clip, then the whole bank (clips, characters) and the estimated credits.
- **The credits are an estimate**: ElevenLabs bills text-to-speech per character sent, 1
  credit per character for its standard models and 0.5 for the Flash and Turbo families
  (`creditsPerChar` in `bank.ts`); a model id that is neither, `eleven_v4` included, is
  counted as standard. The real charge is the `character-cost` header of each bought clip,
  which `--buy` prints per clip and in total.
- `--buy` is incremental (a clip that is there is never bought again), refuses more than
  4000 characters in one run, stops after 3 failures in a row, and with `ffmpeg` on PATH
  cuts the silence off both ends of each bought clip.
- Commit the new folder afterwards: production serves the clips from the repo.
