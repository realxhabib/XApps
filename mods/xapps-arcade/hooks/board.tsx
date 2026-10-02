// The Four in a Row board, drawn in cells on the drawing thread. You are red
// and move first; the XApps bot (the same search the web game uses) answers
// after a short beat. ←/→ or the mouse aims, Enter, Space, ↓ or a click
// drops, 1–7 drops straight into a column, N starts a new game.

import type { ClientModule, ClientSurface } from 'claude-code'

import { COLS, ROWS, cellAt, chooseBotMove, playMove, replay, type GameState, type Seat } from './four'

type Props = { moves: number[]; record: string; countdown: number }

type Box = {
  game: GameState
  aim: number
  /** When the bot may answer (ms on the frame clock), or 0 when it isn't its turn. */
  botAt: number
  now: number
  /** The game's result was posted (once per game). */
  reported: boolean
}

type Local = { box: Box; v: number }

const ME: Seat = 0
const BOT: Seat = 1
const BOT_THINK_MS = 550
const TICK_MS = 50
/** Each cell is this many columns wide; the board starts one column in. */
const CELL_W = 4
const LEFT = 1

const COLORS = {
  board: '#1d4ed8',
  hole: '#0b1640',
  me: '#ff4d6d',
  bot: '#ffd23f',
  win: '#ffffff',
}

function start(props: Props): GameState {
  return replay(props.moves ?? []) ?? replay([])!
}

function firstOpen(game: GameState, from: number): number {
  for (let d = 0; d < COLS; d++) {
    for (const c of [from + d, from - d]) if (c >= 0 && c < COLS && game.heights[c]! < ROWS) return c
  }
  return 3
}

const Board: ClientModule<Props, Local> = (props, surface) => {
  const { Box: Row, Text } = surface.elements

  // First draw: local state, the bot's clock, and the props' game.
  if (surface.state === undefined) {
    const game = start(props)
    const box: Box = { game, aim: firstOpen(game, 3), botAt: 0, now: 0, reported: game.over }
    if (!game.over && game.turn === BOT) box.botAt = BOT_THINK_MS
    surface.every(TICK_MS, () => tick(surface, box))
    surface.setState({ box, v: 0 })
  }
  const box = surface.state?.box ?? { game: start(props), aim: 3, botAt: 0, now: 0, reported: true }
  const { game } = box

  surface.onKey(event => {
    const key = event.key.toLowerCase()
    if (key === 'left' || key === 'h' || key === 'a') aimAt(surface, box, box.aim - 1)
    else if (key === 'right' || key === 'l' || key === 'd') aimAt(surface, box, box.aim + 1)
    else if (key === 'return' || key === ' ' || key === 'space' || key === 'down' || key === 's') drop(surface, box, box.aim)
    else if (/^[1-7]$/.test(key)) drop(surface, box, Number(key) - 1)
    else if (key === 'n' || key === 'r') newGame(surface, box)
  })
  surface.onPointer(event => {
    const col = Math.floor((event.x - LEFT) / CELL_W)
    if (col < 0 || col >= COLS) return
    if (event.type === 'move' || event.type === 'enter') aimAt(surface, box, col)
    else if (event.type === 'down' && event.button === 'left') {
      if (game.over && event.y > ROWS + 1) newGame(surface, box)
      else drop(surface, box, col)
    }
  })

  const winning = new Set(game.winLines.flat().map(c => `${c.col},${c.row}`))
  const myMove = !game.over && game.turn === ME

  const aimRow = (
    <Row key="aim">
      <Text> </Text>
      {Array.from({ length: COLS }, (_, c) => (
        <Text key={`a${c}`} color={COLORS.me} bold>
          {c === box.aim && myMove ? ' ▼  ' : `  ${c + 1} `.slice(0, CELL_W).replace(/\d/, ch => (myMove ? ch : ' '))}
        </Text>
      ))}
    </Row>
  )

  const rows = Array.from({ length: ROWS }, (_, i) => {
    const r = ROWS - 1 - i
    return (
      <Row key={`r${r}`}>
        <Text backgroundColor={COLORS.board}> </Text>
        {Array.from({ length: COLS }, (_, c) => {
          const cell = cellAt(game.board, c, r)
          const lit = winning.has(`${c},${r}`)
          return (
            <Text key={`c${c}`} backgroundColor={COLORS.board} color={cell === null ? COLORS.hole : cell === ME ? COLORS.me : COLORS.bot} bold={lit} inverse={lit}>
              {' ● '}
              <Text backgroundColor={COLORS.board}> </Text>
            </Text>
          )
        })}
      </Row>
    )
  })

  const status = game.over
    ? game.winner === ME
      ? 'You connected four! Press N for another.'
      : game.winner === BOT
        ? 'The XApps bot connected four. Press N to go again.'
        : 'Board full: a draw. Press N for another.'
    : myMove
      ? 'Your move: ←/→ or the mouse to aim, Enter or a click to drop.'
      : 'XApps bot is thinking…'

  return (
    <Row flexDirection="column">
      <Row key="head">
        <Text bold color={COLORS.me}>● You</Text>
        <Text dimColor>  vs  </Text>
        <Text bold color={COLORS.bot}>● XApps bot</Text>
        <Text dimColor>   {props.record}</Text>
      </Row>
      {aimRow}
      {rows}
      <Row key="status" marginTop={1}>
        <Text bold={game.over}>{status}</Text>
      </Row>
      {props.countdown > 0 && (
        <Row key="back">
          <Text dimColor>Claude is done: back to the prompt in {props.countdown}…</Text>
        </Row>
      )}
    </Row>
  )
}

function redraw(surface: ClientSurface<Local>, box: Box) {
  surface.setState({ box, v: (surface.state?.v ?? 0) + 1 })
}

function aimAt(surface: ClientSurface<Local>, box: Box, col: number) {
  const next = Math.max(0, Math.min(COLS - 1, col))
  if (next === box.aim) return
  box.aim = next
  redraw(surface, box)
}

function drop(surface: ClientSurface<Local>, box: Box, col: number) {
  if (box.game.over || box.game.turn !== ME) return
  const next = playMove(box.game, col, ME)
  if (!next) return
  box.game = next
  box.aim = col
  box.botAt = next.over ? 0 : box.now + BOT_THINK_MS
  settle(surface, box)
}

function tick(surface: ClientSurface<Local>, box: Box) {
  box.now += TICK_MS
  if (!box.botAt || box.now < box.botAt || box.game.over || box.game.turn !== BOT) return
  box.botAt = 0
  const choice = chooseBotMove(box.game)
  const next = choice ? playMove(box.game, choice.col, BOT) : null
  if (!next) return
  box.game = next
  if (!next.over) box.aim = firstOpen(next, box.aim)
  settle(surface, box)
}

/** After a move: tell the hooks module (it keeps the game between turns), and the result once. */
function settle(surface: ClientSurface<Local>, box: Box) {
  const moves = [...box.game.moves]
  if (box.game.over && !box.reported) {
    box.reported = true
    surface.post({ moves, result: box.game.winner === ME ? 'win' : box.game.winner === BOT ? 'loss' : 'draw' })
  } else {
    surface.post({ moves })
  }
  redraw(surface, box)
}

function newGame(surface: ClientSurface<Local>, box: Box) {
  if (!box.game.over && box.game.moves.length > 0) return
  box.game = replay([])!
  box.aim = 3
  box.botAt = 0
  box.reported = false
  surface.post({ moves: [] })
  redraw(surface, box)
}

export default Board
