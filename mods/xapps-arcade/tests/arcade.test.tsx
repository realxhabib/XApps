import { describe, expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'xapps-arcade',
  component: 'Pane' as const,
  requestId: 'xapps-arcade',
  props: {
    title: 'XApps · Four in a Row',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
  viewport: { columns: 60, rows: 20 },
}

describe('the board', () => {
  test('you drop a disc, the XApps bot answers, on every surface that draws a Client', async $ => {
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      await ui.resize({ columns: 60, rows: 12, in: 'board' })
      expect(await ui.find({ type: 'Text', text: /Your move/, in: 'board' })).toBeDefined()
      await ui.key({ key: 'return', in: 'board' })
      expect(await ui.find({ type: 'Text', text: /thinking/, in: 'board' })).toBeDefined()
      await ui.advance(700)
      expect(await ui.find({ type: 'Text', text: /Your move/, in: 'board' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('a click aims and drops in the column under the pointer', async $ => {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.resize({ columns: 60, rows: 12, in: 'board' })
    // Column 7 (index 6) spans cells 25..28.
    await ui.pointer({ type: 'down', x: 26, y: 3, button: 'left', in: 'board' })
    expect(await ui.find({ type: 'Text', text: /thinking/, in: 'board' })).toBeDefined()
    await ui.unmount()
  })

  test('mobile and the editor get a note instead of a board', async $ => {
    for (const surface of ['mobile', 'vscode'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ type: 'Text', text: /terminal or the desktop app/ })).toBeDefined()
      await ui.unmount()
    }
  })
})

/** A command the person typed in the composer. */
const TYPED = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }

describe('the hand-off', () => {
  test('/xapps turns it on and opens the pane, /xapps off closes it', async ($, on) => {
    mock.store(on)
    const opened: string[] = []
    const closed: string[] = []
    on('ui.open', async (_$, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true as const } }
    })
    on('ui.close', async (_$, e) => {
      closed.push(e.id)
      return { value: undefined }
    })
    on('command.register', async (_$, e) => ({ value: { command: e.name } }))
    on('session.start', async (_$, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    const on1 = await $.command.run({ command: 'xapps', args: '', ...TYPED })
    expect(on1.text).toMatch(/is on/)
    expect(opened).toEqual(['xapps-arcade'])
    const off = await $.command.run({ command: 'xapps', args: 'off', ...TYPED })
    expect(off.text).toMatch(/is off/)
    expect(closed).toContain('xapps-arcade')
  })
})
