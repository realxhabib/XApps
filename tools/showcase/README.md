# XApps showcase video tooling

Scripts that produced the 52 s promo (`xapps-showcase.mp4`, 1920×1080, 30 fps). Each shot is captured
**frame by frame on a fake clock** (Playwright `clock` + rAF/WAAPI slaved to it, see `rec.mjs`), so
footage is perfectly smooth no matter how fast the machine renders. `compose.py` then cuts the frame
folders together from an edit list (`edl.json`), and `audio.py` synthesizes the music bed.

Run this on a machine with a GPU: in a GPU-less cloud container the 3D games render at 1–6 fps and a
full capture takes hours (`SHOWCASE_SOFTWARE_GL=1` forces that software path). With a GPU it runs close
to real time.

## Setup

```bash
# 1. XApps in demo mode on :3000 (from the repo root)
NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= npm run dev

# 2. Starship League with its XApps mode on :4100 (branch claude/dazzling-johnson-205r5p until merged)
cd ../starship-league && PORT=4100 node tools/dev-server.js

# 3. Tools: Playwright (already a dev dependency here), Python 3 with Pillow + imageio-ffmpeg
pip install pillow imageio-ffmpeg
```

`rec.mjs` routes `https://starshipleague.vercel.app/**` to `localhost:4100`, so the play room loads the
local build. Set `SHOWCASE_THREE=/path/three.min.js` only if the machine can't reach cdnjs.

## Shots

Run from this folder; frames land in `frames/<dir>/00000.jpg…`. The folder names are what `edl.json`
references. Arguments are the ones used for the cut (scale = device pixel ratio on a 1280×720 viewport,
so 1.5 → 1920×1080).

| Folder | Command | Shot |
| --- | --- | --- |
| `card-open`, `card-end`, `cap-*` | `node cards.mjs <dir> <open\|end\|cap> <seconds> [query]` | Title/end cards and captions (`cards/cards.html`) |
| `home` | `node home.mjs` | Hero entrance, scroll to Featured |
| `garage` | `node garage.mjs 1.5 garage` | Wedge Wars garage turntable + loadout swap |
| `wwroom` | `node ww-room.mjs 1.5 wwroom 150` | Wedge Wars in the play room: lock in, free-for-all intro, charge |
| `ww3` | `node ww-scout.mjs 3 shoot 16.7 ww3` | Seed 3 pile-up and KO (scout seeds first with `scout` mode) |
| `sl` | `node sl-shoot.mjs shoot sl 40` | Starship League practice in the play room |
| `arena` | `node arena.mjs 1.3333333 arena` | Meme Duel voting in the Arena |
| `chal` | `node challenge.mjs 1.5 chal` | Challenge → VS intro → 3-2-1 → Reflexes → Victory |
| `dev`, `dev2` | `node dev.mjs 1.5 dev` | Register an app with images, console Versions, review queue |

`ww.mjs` and `sl.mjs` are helpers (read game state, keyboard autopilot). `sheet.py` makes contact sheets.

## Edit and render

```bash
python3 compose.py edl.json cut.mp4 --preview      # fast check (low quality)
python3 compose.py edl.json cut.mp4 --crf=19       # final video (no audio)
python3 audio.py 52.07 <pulse_start_s> <pulse_end_s> bed.wav
ffmpeg -i cut.mp4 -i bed.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 160k -shortest -movflags +faststart xapps-showcase.mp4
```

(`ffmpeg` is `python3 -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"` if it isn't installed.)
`edl.json` clips: `{src, start, end, xfade?, caption?: {dir, at}, crop?, step?, hold?}` in frames.
`edl-vertical.json` is the 26 s 1080×1920 cut for X (`xapps-showcase-vertical.mp4`). Its shots:

```bash
node cards.mjs vcard-open open 3 "v=1"
node cards.mjs vcard-end end 3.5 "v=1"
node cards.mjs vcap-ww cap 2.5 "v=1&e=Wedge%20Wars%20%C2%B7%202%E2%80%934%20players&h=Wreck%20your%20friends."
node cards.mjs vcap-sl cap 2.5 "v=1&e=Community%20app%20%C2%B7%20by%20%40realxhabib&h=Starship%20League."
node cards.mjs vcap-chal cap 2.5 "v=1&e=Any%20app%20%C2%B7%20anyone%20on%20X&h=Send%20a%20challenge."
node cards.mjs vcap-win cap 2.5 "v=1&e=Results%20%C2%B7%20XP%20%C2%B7%20Achievements&h=Keep%20the%20receipts."
node ww-scout.mjs 9 shoot 10 ww9v 0 - - 1.7777778 portrait   # KO at fight frame ~202
node sl-shoot.mjs shoot sl 40                                  # reframed to portrait by the EDL crop
node challenge-v.mjs 2.6666667 chalv
python3 compose.py edl-vertical.json work/vcut.mp4 --crf=19
python3 audio.py 25.93 2.0 22.1 work/vbed.wav
```

`edl-short.json` is the 14 s launch clip (`xapps-short.mp4`: challenge sent → VS → a round played → Victory/Share →
end card), cut from a calmer capture that picks @neon_nomad from the list (no typing, so the sheet never jumps):

```bash
node challenge-short.mjs 2.6666667 chals
node cards.mjs vcap-chal-top cap 3 "v=1&dur=3&pos=top&e=Any%20app%20%C2%B7%20anyone%20on%20X&h=Send%20a%20challenge."
node cards.mjs vcap-share cap 2.8 "v=1&dur=2.8&e=Results%20%C2%B7%20XP%20%C2%B7%20Achievements&h=Share%20the%20win%20on%20X."
node cards.mjs vcard-short end 2.5 "v=1&tag=Build%20any%20game.%3Cbr%3EWe%20wire%20it%20to%20%3Cspan%20class%3D%22grad%22%3EX.%3C%2Fspan%3E&chip=%3Cb%3E%E2%86%92%3C%2Fb%3E%20xapps.vercel.app"
python3 audio.py 13.57 0.5 11.07 work/sbed.wav
```

`edl-short-sl.json` is the 15 s landscape launch clip with Starship League (`xapps-short-starship.mp4`): challenge
@neon_nomad → VS → kickoff → goal → Victory/Share → end card. The capture stages the match from the harness only
(the game is untouched): Starship League's All-Star AI flies our ship, the rival flies at Rookie, the clock starts
at 75 s and jumps to 4 s once we lead. Needs Starship League on :4100.

```bash
node sl-challenge.mjs 1280 720 1.5 slc
node cards.mjs hcap-chal cap 3 "dur=3&pos=top&e=Any%20game%20%C2%B7%20anyone%20on%20X&h=Send%20a%20challenge."
node cards.mjs hcap-sl cap 3 "dur=3&e=Community%20app%20%C2%B7%20by%20%40realxhabib&h=Starship%20League."
node cards.mjs hcap-share cap 2.8 "dur=2.8&side=right&e=Results%20%C2%B7%20XP%20%C2%B7%20Achievements&h=Share%20the%20win%20on%20X."
node cards.mjs hcard-short end 2.5 "tag=Build%20any%20game.%20We%20wire%20it%20to%20%3Cspan%20class%3D%22grad%22%3EX.%3C%2Fspan%3E&chip=%3Cb%3E%E2%86%92%3C%2Fb%3E%20xapps.vercel.app"
python3 compose.py edl-short-sl.json work/slcut.mp4 --crf=19
python3 audio.py 15.2 0.5 12.7 work/slbed.wav
```

Capture at scale ≥ 1: below a device pixel ratio of 1 the site's confetti canvas smears.

Frame indices depend on the run (GPU timing can change a seed's fight), so check a contact sheet before composing.
