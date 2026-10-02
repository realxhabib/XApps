// xapps-arcade: XApps games in a pane while Claude works. Four in a Row
// against the XApps bot opens beside the transcript once Claude has been
// working for a couple of seconds; when Claude is done there's a short
// countdown and you're handed back, and right away if Claude needs you. The
// game in progress is kept, so the next turn picks it up where you left it.

import type { EngineInterface, Register } from 'claude-code'

type Engine = EngineInterface

const PANE = 'xapps-arcade'
const TITLE = 'XApps · Four in a Row'
const DROP_IN_DELAY_MS = 2000
const COUNTDOWN_SECONDS = 3

type Record3 = { wins: number; losses: number; draws: number }

/** What the board module posts back (see board.tsx). */
type BoardPost = { moves: number[] } | { moves: number[]; result: 'win' | 'loss' | 'draw' }

type Timer = { cancel: () => void }

// Whether the person turned the arcade on (kept between sessions in $.store)
let isOn = false
let record: Record3 = { wins: 0, losses: 0, draws: 0 }
// The game in progress: the columns played, you first. Survives the pane closing between turns.
let moves: number[] = []

//   idle      not playing
//   waiting   Claude is working; dropping in once the delay passes
//   playing   the pane is open
//   countdown Claude is done; closing when the count reaches zero
let phase: 'idle' | 'waiting' | 'playing' | 'countdown' = 'idle'
let isTurnRunning = false
// Closed by hand during this turn, so stay out until the next one
let isDismissed = false
let timer: Timer | null = null
let countdown = 0

function cancelTimer() {
  timer?.cancel()
  timer = null
}

function armDropIn($: Engine) {
  if (!isOn || !isTurnRunning || isDismissed || phase !== 'idle') return
  phase = 'waiting'
  timer = $.clock.after(DROP_IN_DELAY_MS, () => void dropIn($))
}

async function dropIn($: Engine) {
  if (phase !== 'waiting') return
  timer = null
  const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true })
  if (!opened.isPlaced) {
    // Opened unasked on a narrow terminal it would pop up long after the moment passed.
    await $.ui.close({ id: PANE })
    phase = 'idle'
    return
  }
  phase = 'playing'
  $.ui.invalidate('ui.render')
}

function startCountdown($: Engine) {
  cancelTimer()
  phase = 'countdown'
  countdown = COUNTDOWN_SECONDS
  $.ui.invalidate('ui.render')
  timer = $.clock.every(1000, () => {
    countdown--
    if (countdown > 0) $.ui.invalidate('ui.render')
    else void handBack($)
  })
}

async function handBack($: Engine) {
  cancelTimer()
  if (phase === 'idle') return
  phase = 'idle'
  await $.ui.close({ id: PANE })
}

function recordText(r: Record3) {
  return `You ${r.wins} · Bot ${r.losses}` + (r.draws ? ` · Draws ${r.draws}` : '')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    isOn = (await $.store.get('isOn')) === true
    const saved = (await $.store.get('record')) as Record3 | undefined
    if (saved && typeof saved === 'object') record = { wins: saved.wins ?? 0, losses: saved.losses ?? 0, draws: saved.draws ?? 0 }
    await $.command.register({
      name: 'xapps',
      description: 'Play XApps games while Claude works',
      argumentHint: '[off]',
    })
    return next(e)
  })

  on('command.run', { command: 'xapps' }, async ($, e) => {
    if (e.args.trim() === 'off') {
      isOn = false
      await $.store.set('isOn', false)
      await handBack($)
      return { text: 'XApps arcade is off. /xapps turns it back on.' }
    }
    isOn = true
    await $.store.set('isOn', true)
    // Opened by the person, it seats at any width: play right now too.
    cancelTimer()
    const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true })
    if (opened.isPlaced) phase = 'playing'
    return { text: 'XApps arcade is on: Four in a Row opens while Claude works. /xapps off turns it off.' }
  })

  on('turn.start', async ($, e, next) => {
    isTurnRunning = true
    isDismissed = false
    if (phase === 'countdown') {
      // A queued prompt started straight away, so keep playing
      cancelTimer()
      phase = 'playing'
      $.ui.invalidate('ui.render')
    }
    armDropIn($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e)
    isTurnRunning = false
    if (phase === 'waiting') {
      cancelTimer()
      phase = 'idle'
    } else if (phase === 'playing') {
      if (e.isAborted) await handBack($)
      else startCountdown($)
    }
    return next(e)
  })

  // Claude needs you (a permission prompt, a question): hand back at once.
  on('tool.check', async ($, e, next) => {
    const result = await next(e)
    if (e.tool_use_id && result.decision === 'ask') {
      cancelTimer()
      if (phase === 'waiting') phase = 'idle'
      else await handBack($)
    }
    return result
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'AskUserQuestion') await handBack($)
    const result = await next(e)
    // Once an answered prompt lets Claude carry on, drop back in
    armDropIn($)
    return result
  })

  on('ui.close', async ($, e, next) => {
    if (e.id !== PANE) return next(e)
    if (e.origin?.kind === 'person' && isTurnRunning) isDismissed = true
    cancelTimer()
    phase = 'idle'
    return next(e)
  })

  // The board posts the moves after each one, and the result when a game ends.
  on('ui.message', async ($, e) => {
    if (e.element !== 'board') return {}
    const data = e.data as BoardPost
    if (!data || !Array.isArray(data.moves)) return {}
    moves = data.moves.filter(n => Number.isInteger(n) && n >= 0 && n < 7).slice(0, 42)
    if ('result' in data) {
      if (data.result === 'win') record = { ...record, wins: record.wins + 1 }
      else if (data.result === 'loss') record = { ...record, losses: record.losses + 1 }
      else record = { ...record, draws: record.draws + 1 }
      await $.store.set('record', record)
      $.ui.toast(data.result === 'win' ? `You beat the XApps bot! ${recordText(record)}` : data.result === 'loss' ? `The XApps bot wins. ${recordText(record)}` : `A draw. ${recordText(record)}`)
    }
    return { props: { moves, record: recordText(record), countdown: phase === 'countdown' ? countdown : 0 } }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>XApps games play in the terminal or the desktop app.</Text>
    }
    const { Box, Client } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Client
          key="board"
          module="./board.tsx"
          props={{ moves, record: recordText(record), countdown: phase === 'countdown' ? countdown : 0 }}
          flexGrow={1}
        />
      </Box>
    )
  })
}
