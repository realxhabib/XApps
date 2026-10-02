# Nova Rally — audio credits

Every recording here is **CC0 1.0 (public domain)**
(https://creativecommons.org/publicdomain/zero/1.0/). No attribution is
required; we credit the authors anyway. Licenses were checked on each source
page (OpenGameArt) and in each pack's `License.txt` (Kenney).

The files are built by `apps/web/scripts/render-nova-audio.mjs`, which
downloads these sources, then layers, pitch-shifts, trims and normalizes them
(effects are matched to the loudness of the synth effects they replaced) and
encodes MP3:

- `sfx.mp3` (one sprite, 112 kbps): every effect, the announcer lines and the
  engine loops. Offsets are in `manifest.json`.
- `music-<world>.mp3` and `music-<world>-final.mp3` (96 kbps): one looping
  track per world and its faster "climax" take for the final lap.

The WebAudio synths in `src/first-party/nova-rally/audio.ts` are only a
fallback while (or if) these files don't load. The drift whine/screech layer
of the engine is still synthesized, and the "Wrong way!" call and the pilots'
catchphrases use the browser's speech synthesis (no recording exists).

## Sound effects, voice and jingles — Kenney (https://kenney.nl, CC0)

| Pack | Used for | URL |
| --- | --- | --- |
| Sci-Fi Sounds 1.0 | engine loops (`engineCircular_002`, `spaceEngineLow_003`, `thrusterFire_003`), boosts, thrusters, lasers, force fields, explosions | https://kenney.nl/assets/sci-fi-sounds |
| Impact Sounds | wall hits, bumps, landings, item-box and shield glass | https://kenney.nl/assets/impact-sounds |
| Interface Sounds | countdown/coin chimes, roulette ticks, lap, UI clicks, position changes | https://kenney.nl/assets/interface-sounds |
| Digital Audio | power-ups, phasers, zaps, jumps | https://kenney.nl/assets/digital-audio |
| Voiceover Pack (Female voice) | the announcer: 3, 2, 1, go, final round, you win, you lose, congratulations, new high score, target destroyed, look out, go go go, power up, game over, time over, hurry up, mission completed | https://kenney.nl/assets/voiceover-pack |
| Music Jingles | win (`jingles_NES12`), lose (`jingles_NES07`), podium (`jingles_STEEL02`), finish sting (`jingles_HIT03`) | https://kenney.nl/assets/music-jingles |

## Music — MintoDog, "For Racing Game" (OpenGameArt, CC0)

Collection: https://opengameart.org/content/for-racing-game-mintodogs-music

| World | Files | Track | URL |
| --- | --- | --- | --- |
| Mars (Olympus Canyon) | `music-mars.mp3`, `music-mars-final.mp3` | Hot Roadway (Remake) + Climax | https://opengameart.org/content/hot-roadway-remake |
| Belt (Asteroid Gauntlet) | `music-belt.mp3`, `music-belt-final.mp3` | Darkness Road + Climax | https://opengameart.org/content/darkness-roadremake |
| Saturn (Ring Road) | `music-saturn.mp3`, `music-saturn-final.mp3` | Pure Raceway + Climax | https://opengameart.org/content/pure-raceway |
| Nebula (Station Zero) | `music-nebula.mp3`, `music-nebula-final.mp3` | Cool Highway + Climax | https://opengameart.org/content/cool-highway |
| Luna (Crater Rush) | `music-luna.mp3`, `music-luna-final.mp3` | Sky Blue Street + Climax | https://opengameart.org/content/sky-blue-street |
| Sun (Solar Corona) | `music-sun.mp3`, `music-sun-final.mp3` | Fever Stadium + Climax | https://opengameart.org/content/fever-stadium |
| Europa (Europa Ice) | `music-europa.mp3`, `music-europa-final.mp3` | Blossom Mountain + Climax | https://opengameart.org/content/blossom-mountainremake |
| Menus, results, podium | `music-menu.mp3` | Racing Game Menu | https://opengameart.org/content/racing-game-menu |

The final-lap jingle in `sfx.mp3` is "Final Lap (Jingle)" from MintoDog's
Racing Game Finish & Jingle (CC0):
https://opengameart.org/content/racing-game-finish-jingle
