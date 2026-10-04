# The AI partner: every line that is banked

Generated from `fixedLineList('default')` in `server/src/ai/scripted.ts` and `VOCAB` in `shared/src/bot/vocab.ts`; "before" is commit `f12c2d0`.
Persona: default (the friendly partner). Voice `r1KmysJdVYZjJCm4mL3b`, bank model `eleven_v4`.

## 1. Changed lines

24 of 59 fixed lines changed: contractions for natural speech only, same meaning. The one exception is `laser-path.in.side`: its fixed example "Say face 4." looked like the answer and now reads "Say the face number." (the script takes "face 4" or just "4"). No line was added or removed; relay lines and the vocabulary are untouched.

| Key | Before | After |
| --- | --- | --- |
| `hello.out` | Hi! I am outside the cube. I will tell you what I see. Short words work best. | Hi! I'm outside the cube. I'll tell you what I see. Short words work best. |
| `hello.in` | Hi! I am inside the cube. I will tell you what I see. Short words work best. | Hi! I'm inside the cube. I'll tell you what I see. Short words work best. |
| `huh` | Sorry, I did not get that. Short words work best: go, wait, yes, no. | Sorry, I didn't get that. Short words work best: go, wait, yes, no. |
| `wait.ok` | Okay, waiting. Say go when you are ready. | Okay, waiting. Say go when you're ready. |
| `follow.far` | I cannot hear you at all. I am coming around to your side. | I can't hear you at all. I'm coming around to your side. |
| `next` | There is more to solve. Lead the way, I will follow. | There's more to solve. Lead the way, I'll follow. |
| `unknown` | I do not know this puzzle yet. I will stay close and keep my hands off. | I don't know this puzzle yet. I'll stay close and keep my hands off. |
| `equation-safe.out.intro` | I will count for you: the bushes, the birds and the rocks I see. | I'll count for you: the bushes, the birds and the rocks I see. |
| `mirrored-glyph.in.next` | Row done. What is the next row? | Row done. What's the next row? |
| `botanical-mirror.out.strike` | That was the wrong pot. I have the flower back. Which row and column? | That was the wrong pot. I've got the flower back. Which row and column? |
| `sequence-laser.in.battery` | The laser is dead. I am getting the battery from the vault on face 2. | The laser is dead. I'm getting the battery from the vault on face 2. |
| `sequence-laser.in.first` | What is the first symbol? | What's the first symbol? |
| `sequence-laser.in.next` | What is next? | What's next? |
| `laser-path.out.mirrors` | I am pushing the mirrors to burn the crate. Stay on the ring, the lava is hot. | I'm pushing the mirrors to burn the crate. Stay on the ring, the lava is hot. |
| `laser-path.out.ready` | Say yes when you are there, and yes after each part. Say again to hear it. | Say yes when you're there, and yes after each part. Say again to hear it. |
| `laser-path.out.fell` | You fell in. You are back on the ring, right beside the start of the path. | You fell in. You're back on the ring, right beside the start of the path. |
| `laser-path.in.side` | I am staying on the ring. Which face does the path start next to? Say face 4. | I'm on the ring. Which face does the path start next to? Say the face number. |
| `laser-path.in.lava.up` | I am on that side of the ring. On my screen the lava is up. | I'm on that side of the ring. On my screen the lava is up. |
| `laser-path.in.lava.down` | I am on that side of the ring. On my screen the lava is down. | I'm on that side of the ring. On my screen the lava is down. |
| `laser-path.in.lava.left` | I am on that side of the ring. On my screen the lava is left. | I'm on that side of the ring. On my screen the lava is left. |
| `laser-path.in.lava.right` | I am on that side of the ring. On my screen the lava is right. | I'm on that side of the ring. On my screen the lava is right. |
| `laser-path.in.ready` | I am on that tile. Which way now? Say it like: right 2 then up 1. | I'm on that tile. Which way now? Say it like: right 2 then up 1. |
| `laser-path.in.fell` | I fell in the lava. I am back beside the start of the path. Which way from here? | I fell in the lava. I'm back beside the start of the path. Which way from here? |
| `event.stuck` | You have gone quiet. Tell me what you see. | You've gone quiet. Tell me what you see. |

## 2. Every fixed line (key -> text), as it will be banked

| Key | Chars | Text |
| --- | ---: | --- |
| `hello.out` | 74 | Hi! I'm outside the cube. I'll tell you what I see. Short words work best. |
| `hello.in` | 73 | Hi! I'm inside the cube. I'll tell you what I see. Short words work best. |
| `solved` | 10 | It worked! |
| `win` | 10 | We did it! |
| `huh` | 67 | Sorry, I didn't get that. Short words work best: go, wait, yes, no. |
| `wait.ok` | 40 | Okay, waiting. Say go when you're ready. |
| `follow.where` | 55 | I can barely hear you. Tell me your face, like: face 3. |
| `follow.far` | 56 | I can't hear you at all. I'm coming around to your side. |
| `next` | 49 | There's more to solve. Lead the way, I'll follow. |
| `unknown` | 68 | I don't know this puzzle yet. I'll stay close and keep my hands off. |
| `hidden-code.out.intro` | 70 | I see a number in the grass. Type it on your keypad, then press ENTER. |
| `hidden-code.ask.first` | 23 | What's the first digit? |
| `hidden-code.ask.next` | 22 | What's the next digit? |
| `hidden-code.wrong` | 52 | That code was wrong. Tell me the three digits again. |
| `equation-safe.out.intro` | 62 | I'll count for you: the bushes, the birds and the rocks I see. |
| `equation-safe.ask.bushes` | 27 | How many bushes do you see? |
| `equation-safe.ask.birds` | 26 | How many birds do you see? |
| `equation-safe.ask.rocks` | 26 | How many rocks do you see? |
| `equation-safe.wrong` | 52 | The safe said no. Count again: bushes, birds, rocks. |
| `mirrored-glyph.out.intro` | 69 | Rows from the top. Upright, count from YOUR RIGHT. Say next or again. |
| `mirrored-glyph.out.done` | 62 | That was the last row. Say row and a number to hear one again. |
| `mirrored-glyph.in.ask` | 71 | Upright, count from your left. Tell me a row like: row 1 skip 3 flip 7. |
| `mirrored-glyph.in.next` | 30 | Row done. What's the next row? |
| `mirrored-glyph.in.cleared` | 42 | All tiles are off. Start again from row 1. |
| `botanical-mirror.out.ask` | 78 | Which pot? Say row and column. Rows from the face 5 edge, columns from face 3. |
| `botanical-mirror.out.nopot` | 73 | I see no pot there. Rows count from the face 5 edge, columns from face 3. |
| `botanical-mirror.out.strike` | 71 | That was the wrong pot. I've got the flower back. Which row and column? |
| `botanical-mirror.in.ask` | 61 | What colour is your flower? Red, blue, yellow, pink or white? |
| `botanical-mirror.in.how` | 68 | Rows count from the edge by face 5, columns from the edge by face 3. |
| `botanical-mirror.in.strike` | 66 | That was the wrong pot. Count from the edges by face 5 and face 3. |
| `sequence-laser.in.battery` | 68 | The laser is dead. I'm getting the battery from the vault on face 2. |
| `sequence-laser.in.how` | 68 | The laser has power. Tell me the symbols in the order they light up. |
| `sequence-laser.in.first` | 24 | What's the first symbol? |
| `sequence-laser.in.next` | 12 | What's next? |
| `sequence-laser.in.strike` | 77 | That one was wrong, it all went dark. Tell me the order again from the start. |
| `sequence-laser.out.dark` | 75 | The symbols are dark. The laser on your side needs the battery from face 2. |
| `sequence-laser.out.how` | 70 | I watched the symbols light up. Say again to hear the order once more. |
| `sequence-laser.out.strike` | 54 | That one was wrong. Start over, from the first symbol. |
| `laser-path.out.mirrors` | 77 | I'm pushing the mirrors to burn the crate. Stay on the ring, the lava is hot. |
| `laser-path.out.side.1` | 77 | I see the path. It starts from the side of the ring next to face 1. Go there. |
| `laser-path.out.side.2` | 77 | I see the path. It starts from the side of the ring next to face 2. Go there. |
| `laser-path.out.side.3` | 77 | I see the path. It starts from the side of the ring next to face 3. Go there. |
| `laser-path.out.side.4` | 77 | I see the path. It starts from the side of the ring next to face 4. Go there. |
| `laser-path.out.lava` | 74 | On that side, which way is the lava from you? Say up, down, left or right. |
| `laser-path.out.tile` | 77 | Now the tile to start from. Rows count from your top, columns from your left. |
| `laser-path.out.ready` | 73 | Say yes when you're there, and yes after each part. Say again to hear it. |
| `laser-path.out.fell` | 73 | You fell in. You're back on the ring, right beside the start of the path. |
| `laser-path.in.side` | 77 | I'm on the ring. Which face does the path start next to? Say the face number. |
| `laser-path.in.lava.up` | 58 | I'm on that side of the ring. On my screen the lava is up. |
| `laser-path.in.lava.down` | 60 | I'm on that side of the ring. On my screen the lava is down. |
| `laser-path.in.lava.left` | 60 | I'm on that side of the ring. On my screen the lava is left. |
| `laser-path.in.lava.right` | 61 | I'm on that side of the ring. On my screen the lava is right. |
| `laser-path.in.tile` | 73 | Which tile do I start from? Say row or column and a number, on my screen. |
| `laser-path.in.ready` | 64 | I'm on that tile. Which way now? Say it like: right 2 then up 1. |
| `laser-path.in.done` | 20 | Done. Which way now? |
| `laser-path.in.ask` | 14 | Which way now? |
| `laser-path.in.fell` | 79 | I fell in the lava. I'm back beside the start of the path. Which way from here? |
| `event.strike` | 41 | Oops, that was a strike. Slow and steady. |
| `event.stuck` | 40 | You've gone quiet. Tell me what you see. |

A relay line (`<id>.relay`) is not a clip of its own: it is said as a chain of these vocabulary pieces, one clip each:

`zero`, `one`, `two`, `three`, `four`, `five`, `six`, `seven`, `eight`, `nine`, `ten`, `eleven`, `twelve`, `red`, `blue`, `yellow`, `pink`, `white`, `sun`, `moon`, `star`, `bolt`, `drop`, `leaf`, `eye`, `up`, `down`, `left`, `right`, `row`, `column`, `flip`, `skip`, `then`, `next`, `pot`, `bushes`, `birds`, `rocks`, `press`, `step`, `the code is`, `the order is`, `the path is`, `the pot is`, `the flower is`

## 3. Dry run totals

`npm run tts:bank -w server` (dry run), model `eleven_v4`: **105 clips, 3558 characters** to buy (limit per run: 4000). That is 59 fixed lines (3330 characters) and 46 vocabulary pieces (228 characters). 0 are banked for this voice today.

