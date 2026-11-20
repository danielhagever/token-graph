import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const ROW = {
  plugin: 'token-graph',
  component: 'AbovePrompt',
  surface: 'desktop',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 3,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 3 },
    view: {},
  },
} as const
const SUMMARY: SessionMessage = { role: 'user', text: 'summary', toolUses: [] }

test('the row says when to compact, and after two compactions to start a new chat', async ($, on) => {
  let tokens = 340_000
  const toasts: string[] = []
  const prompts: string[] = []
  on('command.register', () => ({ value: { command: 'tokens' } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens, window: 1_000_000 }, rateLimits: [], cost: { usd: 12.34, id: 'c' } },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)

    return { text: e.text }
  })
  on('session.compact', () => ({ messages: [SUMMARY], tokensBefore: 340_000, tokensAfter: 45_100 }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(ROW)
  expect((await ui.find({ type: 'Text', text: /spent so far/ }))?.text).toContain('re-reads 340k (34%)')
  expect((await ui.find({ key: 'compact' }))?.props.dimColor).toBe(false)
  // 340k is past the line: the row and a toast both say to compact.
  expect(await ui.find({ type: 'Text', text: /time to compact/ })).toBeDefined()
  expect((await ui.find({ key: 'compact' }))?.props.variant).toBe('primary')
  expect(toasts).toEqual([expect.stringContaining('Time to compact')])

  await $.session.compact({ trigger: 'manual', messages: [SUMMARY] })
  expect((await ui.find({ type: 'Text', text: /spent so far/ }))?.text).toContain('re-reads 45.1k (5%)')
  expect(await ui.find({ type: 'Text', text: /time to compact/ })).toBeUndefined()
  expect((await ui.find({ key: 'compact' }))?.props.dimColor).toBe(true)
  await ui.press({ key: 'compact' })
  expect(toasts[1]).toContain('only 45.1k')

  // The next response reports its own context, which wins over the compaction's.
  tokens = 70_000
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect((await ui.find({ type: 'Text', text: /spent so far/ }))?.text).toContain('re-reads 70.0k (7%)')
  expect(toasts).toHaveLength(2)

  // Crossing the line again nudges again, once.
  tokens = 160_000
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(toasts).toHaveLength(3)
  expect(toasts[2]).toContain('re-reads 160k')
  expect(toasts[2]).toContain('Time to compact')
  expect((await ui.find({ type: 'Text', text: /spent so far/ }))?.text).toContain('compacted 1×')

  // Past the line again after two compactions: a new chat, not a third summary.
  await $.session.compact({ trigger: 'manual', messages: [SUMMARY] })
  tokens = 170_000
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(toasts).toHaveLength(4)
  expect(toasts[3]).toContain('compacted 2 times')
  expect(toasts[3]).toContain('Press New chat')
  expect(await ui.find({ type: 'Text', text: /time for a new chat/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /time to compact/ })).toBeUndefined()
  expect((await ui.find({ key: 'compact' }))?.props.variant).toBe('secondary')
  expect((await ui.find({ key: 'new-chat' }))?.props.dimColor).toBe(false)
  expect((await ui.find({ key: 'new-chat' }))?.props.variant).toBe('primary')
  await ui.press({ key: 'new-chat' })
  expect(prompts).toEqual([expect.stringContaining('HANDOFF.md')])

  // Back under the line: New chat is gray again and only explains.
  tokens = 90_000
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect((await ui.find({ key: 'new-chat' }))?.props.dimColor).toBe(true)
  await ui.press({ key: 'new-chat' })
  expect(prompts).toHaveLength(1)
  expect(toasts[toasts.length - 1]).toContain('Not needed yet')
  await ui.unmount()
})
