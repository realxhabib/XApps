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
`edl-vertical.json` is an unfinished 1080×1920 cut for X (see "next steps" in the commit that added this folder).
