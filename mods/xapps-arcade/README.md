# xapps-arcade

XApps games inside Claude Code. While Claude works, a pane opens beside the
transcript and you play **Four in a Row against the XApps bot** (the same rules
and bot as the web game). When Claude finishes there's a three-second
countdown and you're handed back; if Claude needs you (a permission prompt, a
question) you're handed back at once. The game in progress waits for the next
turn, and your record against the bot is kept between sessions.

## Install

```
/plugin install xapps-arcade --marketplace realxhabib/XApps
/xapps
```

`/xapps` turns it on and opens a game right away; `/xapps off` turns it off.
It works in the terminal and in the desktop app's Code tab. The pane opens on
its own in terminals at least 144 columns wide (any width when you run `/xapps`).

## Controls

| | |
| :- | :- |
| Aim | ← → (or A/D), or move the mouse over a column |
| Drop | Enter, Space or ↓, or click a column; 1–7 drops straight into a column |
| New game | N, once a game is over |

## How it's built

A Claude Code mod is a plugin of function hooks (`hooks/register.tsx`):

- `turn.start` / `turn.complete` / `tool.check` decide when to open the pane
  (`$.ui.open`), count down and hand back (`$.ui.close`).
- `ui.render` on the pane draws a `Client`: `hooks/board.tsx`, a module that
  runs on the drawing thread at frame rate, draws the board in text cells and
  takes keys and the mouse. It posts each move back (`surface.post` →
  `ui.message`) so the game survives the pane closing between turns.
- `hooks/four.ts` is the web game's `logic.ts`, copied unchanged.

## Adding another XApps game

1. Copy the game's pure logic (no React, no SDK) into `hooks/`.
2. Write a `Client` module that draws it in cells (`Box`, `Text`) and reads
   `surface.onKey` / `surface.onPointer`; `surface.every` for animation.
3. Draw it from the pane's `ui.render` hook (or add a game picker there).

Turn-based and 2D games fit (Reflexes, RPS, Greg's Face, Darts, Mini Golf).
The 3D games would need real pixels (`Raster`/`Image`, terminal only), which
means rendering frames outside the mod, the way intermission runs Doom.

## Checks

```
claude plugin validate mods/xapps-arcade
claude plugin test mods/xapps-arcade
```
