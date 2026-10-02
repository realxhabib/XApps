# Nova Rally — status and next steps

Nova Rally (`/embed/nova-rally`, code in `apps/web/src/first-party/nova-rally/`) is a 3D kart racer in
space for up to 8 racers. It has 7 tracks, 3 battle arenas, 4 cups, and mirror, knockout, battle and
time-trial modes. There are 8 ships, 8 pilots, paint, and thruster and wing parts, shown in a 3D hangar
garage. The game has 11 items, drift mini-turbos, recorded CC0 audio, and high, medium and low quality
presets.

## How quality is being judged

We iterate against a deliberately harsh reviewer, a subagent briefed as an ex-Nintendo QA lead and
Digital Foundry analyst. It compares the game with Mario Kart World and scores nine categories:

- graphics
- visual effects
- track design
- gameplay feel
- items
- HUD/UI
- audio
- feature breadth
- polish

The game **passes at an overall score of 8.5 or more, with no category below 7.5**. The brief is
quoted at the end of this file.

| Round | Overall | Notes |
|---|---|---|
| R1–R3 | 5.2 → 5.7 | First playable through core art |
| R4–R6 | 6.9 / 6.4 / 6.6 | Track kit, effects, HUD |
| R7–R9 | 6.6 / 6.7 / 6.7 | Drift physics, knockout pacing, tag/camera fixes; open-space lane introduced |
| R10 | 6.8 | Lane readable at speed; flare bug fixed; spectate camera fixed |
| R11 | 6.9 | Sun lane, near-lens occluders, rail-grind exploit |
| R12 | pending | First round with real recorded audio |

R11 category scores:

| Category | Score |
|---|---|
| Graphics | 7.1 |
| VFX | 6.9 |
| Track | 7.0 |
| Gameplay | 7.0 |
| Items | 6.6 |
| HUD | 7.1 |
| Audio | 5.5 (before the CC0 audio swap) |
| Breadth | 6.2 |
| Polish | 6.8 |

Visual polish was adding only about 0.1 per round. The two categories that hold the score down are
**audio**, which R12 should now move, and **feature breadth**.

## Next steps, in priority order

### 1. Listen to the new audio (needs a human)

Effects, the engine, the announcer and the music now come from CC0 recordings: the Kenney packs and
MintoDog's "For Racing Game" soundtrack. See `apps/web/public/audio/nova-rally/CREDITS.md`. They were
chosen by file name and measured loudness and pitch, **not by ear**.

- Play a race on each world and note any effect that sounds wrong.
- Each effect is a one-line recipe at the top of `apps/web/scripts/render-nova-audio.mjs`. Change the
  recipe, then rebuild just the sprite with `node scripts/render-nova-audio.mjs --sfx-only`.
- These are still synthesized or spoken by the browser:
  - the drift whine (synth)
  - "Wrong way!" (no recording exists)
  - pilot catchphrases (browser speech)

  Record or license voice lines for these.

### 2. Content breadth (the biggest remaining gap)

- **Saturn's rings track or arena**, which the user asked for. Race across and between the ring bands
  on the hard-light lane: set `lightLane: true` in `tracks.ts`, and the saturn theme in
  `environments.ts` already has the rings and ice. Add it to a cup, and update `track.test.ts` and
  `sim.test.ts` (both loop over `TRACKS`).
- **More tracks.** We have 7; MK World has about 30. A second lap of each cup (eight tracks per cup)
  is a realistic next target.
- **Bigger grids.** The field is 8 (`FIELD_SIZE` in `race.ts`). Try 12, then check frame time on
  "low" and the item odds in `items.ts`.
- **Battle arena "neon"** still plays like a loop circuit. Give it open floor space.

### 3. Open visual defects (from R11)

- **Rival hulls and lane rails can still fill a corner of the frame** at side or low angles. Today
  only shields, projectiles, trails and flares hide near the lens (`scene.ts`, ship update loop).
- **Ramp sides on hard-light tracks are flat glass.** Add a vertical gradient and animated
  chevrons, and make the lip stand out (`trackmesh.ts`, Ramps section).
- **Asteroids and ice still read as soft blobs.** Make them faceted, with crack and strata detail and
  rim light (`environments.ts`, `scene.ts` `buildHazard`).
- **The singularity is hard to read at range.** It needs screen-space lensing and a bigger swirl.
- **The podium** needs a pedestal for the cup, ship celebrations and a branded set (`scene.ts`
  `buildPodium` / `updatePodium`).

### 4. Smaller follow-ups

- **Drift assist.** A held drift is kept off the edge without losing speed, but builds no mini-turbo
  while held there or while grinding a rail. Tune `DRIFT_EDGE_*` in `physics.ts` if it feels too safe.
- **Memory.** About 1.05 GB per process tree mid-race on "medium" (renderer about 330 MB). Music now
  streams through `<audio>` elements; the effects sprite (85 s) is decoded in memory.

## Tooling

- **Debug hooks.** Add `?nr-debug` to the URL to expose `window.__novaRally` (the race runtime, with
  `fastForward(s)`, `autopilot`, `input`, `fire()`, `racers`, `audio`) and `window.__novaScene`
  (`camera`, `photo = {angle, dist, height, lookAhead}`, `camInit`). Use `?quality=high|medium|low` to
  force a preset.
- **Screenshots.** Use `apps/web/scripts/nova-capture.cjs`. It takes a JSON plan with runs, each with a
  `track`, `cup`, `mode`, `players` and `choice`, and steps such as `ff`, `shot`, `eval`, `wait`,
  `autopilot` and `key`.
  - Software GL renders at only 1–3 fps, so fast-forward with `ff` instead of playing in real time.
  - Set `window.__novaScene.camInit=false` before each shot.
  - Run one capture at a time; parallel runs produce black frames.
- **Audio rebuild.** `node scripts/render-nova-audio.mjs` (from `apps/web`) downloads the CC0 sources
  and rebuilds the sprite, music and `manifest.json`. Use `--sfx-only` to rebuild the effects alone.

## The judge brief (reuse for future rounds)

> You are a brutally demanding reviewer (ex-Nintendo EPD QA lead + Digital Foundry graphics analyst).
> The product: Nova Rally, a browser 3D kart racer "like Mario Kart but with rockets and spaceships",
> required to match the graphics of the latest Mario Kart (Mario Kart World) and have even more
> features, racing through space, on planets like Mars, and dodging asteroids. Be harsh and concrete;
> don't grade on a curve for "it's a browser game"; Mario Kart World = 10/10.
>
> Deliver: a score /10 for each of graphics & art direction, visual effects & juice, track design &
> variety, gameplay feel & mechanics, items & combat, HUD/UI & presentation, audio, feature breadth vs
> MK World and polish/bugs, plus an overall /10. PASS only if overall ≥ 8.5 and no category < 7.5.
> Then give a prioritized list of concrete defects (what you saw, which screenshot, why it falls short
> of MK World, and a specific fix with file and function). Read the source to judge AI, netcode and
> physics. Don't edit anything.
