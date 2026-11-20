import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Meta, Point } from '../types'
import { cumulativeChart, perRequestChart, W } from './chart'
import { KINDS, short, sums } from './format'
import type { Kind } from './format'
import { HANDOFF_PROMPT } from './handoff'
import { parseTranscript } from './transcript'

const PANE = 'token-graph'
const TITLE = 'Tokens'
/** The kinds the per-response chart shows: everything but cache reads. */
const FRESH: readonly Kind[] = ['cw', 'i', 'o']
const EMPTY_POINTS: Point[] = []
const EMPTY_META: Meta = { source: 'live' }
const points = atom({ plugin: 'token-graph', key: 'points' } as const, EMPTY_POINTS, { shape: 'points-1' })
const meta = atom({ plugin: 'token-graph', key: 'meta' } as const, EMPTY_META, { shape: 'meta-1' })
/** True while a compaction the row's button started is running. */
const busy = atom({ plugin: 'token-graph', key: 'busy' } as const, false)
/** Claude's orange, for the row's mark. */
const MARK = '#d97757'
/** Below this much context a compaction saves little: the summary alone is about 45k. */
const MIN_COMPACT = 60_000
/** From this much context each message re-reads enough that compacting pays: the row says so. */
const SUGGEST_COMPACT = 150_000
/** After this many compactions a further summary loses too much: past the line, a new chat is better. */
const NEW_CHAT_AFTER = 2

/** What to do about the context now: nothing, compact, or (summaries of summaries) start a new chat. */
function advice(m: Meta): 'compact' | 'new-chat' | undefined {
  const ctx = liveCtx(m)
  if (ctx === undefined || ctx < SUGGEST_COMPACT) return undefined

  return (m.compactions ?? 0) >= NEW_CHAT_AFTER ? 'new-chat' : 'compact'
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** The context the next message will be answered over, as best known now. */
function liveCtx(m: Meta): number | undefined {
  const c = m.compacted
  if (c && (m.ctx === undefined || m.ctx === c.ctxThen)) return c.after

  return m.ctx
}

/** The whole transcript, or for one over $.fs's 4 MiB limit its token lines only, through condense.pl. */
async function readTranscript($: EngineInterface, path: string): Promise<string> {
  try {
    return await $.fs.read(path)
  } catch {
    const r = await $.process.run(['perl', `${$.plugin.root}/hooks/condense.pl`, path], { timeoutMs: 60_000 })
    if (r.exitCode !== 0) throw new Error(r.stderr)

    return r.stdout
  }
}

/** ~/.claude/projects/<cwd with every non-alphanumeric as '-'>/<session id>.jsonl */
async function findTranscript($: EngineInterface): Promise<string | undefined> {
  const root = $.plugin.root
  const at = root.indexOf('/.claude/')
  if (at < 0) return undefined
  const projects = `${root.slice(0, at)}/.claude/projects`
  const file = `${await $.session.id()}.jsonl`
  const dirs = new Set([await $.session.root(), await $.session.cwd()].map(d => d.replace(/[^a-zA-Z0-9]/g, '-')))
  for (const d of dirs) if (await $.fs.exists(`${projects}/${d}/${file}`)) return `${projects}/${d}/${file}`
  for (const entry of await $.fs.list(projects)) {
    if (entry.kind !== 'dir') continue
    const path = `${projects}/${entry.name}/${file}`
    if (await $.fs.exists(path)) return path
  }

  return undefined
}

/** Rebuilds every point from the transcript (the one source of truth) and reads cost and context. */
async function refresh($: EngineInterface): Promise<void> {
  let source: Meta['source'] = 'live'
  let model: string | undefined
  let compactions: number | undefined
  try {
    const path = await findTranscript($)
    if (path) {
      const parsed = parseTranscript(await readTranscript($, path))
      if (parsed.points.length > 0) {
        await update($, points, () => parsed.points)
        source = 'transcript'
        model = parsed.model
        compactions = parsed.compactions
      }
    }
  } catch {
    // Missing, or the perl fallback failed: keep the points counted live.
  }
  const usage = await $.session.usage().catch(() => undefined)
  const before = advice(await read($, meta))
  const now = await update($, meta, old => ({
    source,
    model: model ?? old.model,
    usd: usage?.cost?.usd,
    ctx: usage?.context.tokens,
    win: usage?.context.window,
    compacted: old.compacted,
    compactions: compactions ?? old.compactions,
  }))
  // Once, as the context crosses the line: a nudge to compact, or after enough compactions to start over.
  const after = advice(now)
  if (after && after !== before) {
    const reads = `Each message now re-reads ${short(liveCtx(now) ?? 0)} tokens.`
    $.ui.toast(
      after === 'compact'
        ? `${reads} Time to compact (button above the prompt).`
        : `${reads} This chat was already compacted ${now.compactions} times and each summary loses detail. Press New chat above the prompt and Claude gets the move ready.`,
    )
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'tokens', description: "Show this chat's token usage graph in a pane" })
    await update($, busy, () => false)
    // The graph opens from the row's Graph button or /tokens, not by itself.
    void $.ui.close({ id: PANE })
    await refresh($)

    return next(e)
  })

  on('command.run', { command: 'tokens' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Token graph opened.' }
  })

  // Each main-chat response as it arrives, so the graph moves during a long turn.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    const u = r.usage
    if (!e.agentId && u) {
      const now = await $.clock.now()
      await update($, points, list => {
        const last = list[list.length - 1]
        const p = !last ? 1 : last.turn === e.turnId ? last.p : last.p + 1
        const point: Point = {
          id: `${e.turnId}:${e.index}`,
          turn: e.turnId,
          p,
          t: now,
          i: u.input_tokens,
          o: u.output_tokens,
          cr: u.cache_read_input_tokens,
          cw: u.cache_creation_input_tokens,
        }

        return [...list, point]
      })
    }

    return r
  })

  // At the end of each turn the transcript has it all: recount from there.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) await refresh($)

    return r
  })

  // Any compaction of the main chat, typed or from the button: remember what it left.
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (e.trigger !== 'precompute' && !e.agentId && r.messages && r.tokensAfter !== undefined) {
      const after = r.tokensAfter
      await update($, meta, old => ({
        ...old,
        compacted: { after, ctxThen: old.ctx },
        compactions: (old.compactions ?? 0) + 1,
      }))
    }

    return r
  })

  // One line above the message box: what this chat has used, and a Compact button.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const list = await read($, points)
    const m = await read($, meta)
    const isBusy = await read($, busy)
    const s = sums(list)
    const { Box, Button, Text } = $.ui.resolve(e)
    const ctx = liveCtx(m)
    const pct = ctx !== undefined && m.win ? Math.round((ctx / m.win) * 100) : undefined
    const small = ctx !== undefined && ctx < MIN_COMPACT
    const todo = advice(m)

    // The same /compact you would type. Started from a timer, so it is not cut off
    // by the button press's own time limit while the summary is written.
    const compact = async () => {
      if (isBusy) return
      if (small) {
        $.ui.toast(`Context is only ${short(ctx ?? 0)} tokens. Compacting again would save almost nothing.`)

        return
      }
      if (e.props.isWorking) {
        $.ui.toast('Wait for Claude to finish answering, then compact.')

        return
      }
      await update($, busy, () => true)
      $.clock.after(0, () => {
        $.command
          .run({ command: 'compact' })
          .then(() => refresh($))
          .catch((err: unknown) => $.ui.toast(`Compact failed: ${errText(err)}`))
          .finally(() => update($, busy, () => false))
      })
    }

    // Asks Claude for a handoff a new chat can start from. Gray, and only explains, until it is time.
    const newChat = () => {
      if (todo !== 'new-chat') {
        $.ui.toast(
          `Not needed yet. New chat lights up once this chat has been compacted ${NEW_CHAT_AFTER} times and re-reads ${short(SUGGEST_COMPACT)} again.`,
        )

        return
      }
      if (e.props.isWorking) {
        $.ui.toast('Wait for Claude to finish answering, then press New chat.')

        return
      }
      $.prompt
        .submit({ text: HANDOFF_PROMPT, asUser: true })
        .catch((err: unknown) => $.ui.toast(`Could not send: ${errText(err)}`))
    }

    return (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text color={MARK}>✻</Text>
        <Text>
          This chat: <Text bold>{short(s.all)}</Text> tokens
        </Text>
        <Text dimColor>
          · {short(s.o)} written{m.usd !== undefined ? ` · $${m.usd.toFixed(2)} spent so far` : ''}
          {ctx !== undefined ? ` · each message re-reads ${short(ctx)}${pct !== undefined ? ` (${pct}%)` : ''}` : ''}
          {m.compactions ? ` · compacted ${m.compactions}×` : ''}
        </Text>
        {todo ? <Text color={MARK}>· {todo === 'compact' ? 'time to compact' : 'time for a new chat'}</Text> : null}
        <Button
          key="compact"
          label={isBusy ? 'Compacting…' : 'Compact'}
          dimColor={e.props.isWorking || small}
          variant={todo === 'compact' ? 'primary' : 'secondary'}
          onPress={compact}
        />
        <Button
          key="new-chat"
          label="New chat"
          dimColor={todo !== 'new-chat' || e.props.isWorking}
          variant={todo === 'new-chat' ? 'primary' : 'secondary'}
          onPress={newChat}
        />
        <Button key="graph" label="Graph" plain dimColor onPress={() => $.ui.open({ id: PANE, title: TITLE })} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const list = await read($, points)
    const m = await read($, meta)
    const s = sums(list)
    const prompts = list[list.length - 1]?.p ?? 0
    const sub = `${list.length} responses · ${prompts} prompt${prompts === 1 ? '' : 's'}${m.model ? ` · ${m.model}` : ''}`
    const pct = (v: number) => (s.all ? `${((v / s.all) * 100).toFixed(1)}%` : '0%')
    const cost = m.usd !== undefined ? `  ·  $${m.usd.toFixed(2)} spent` : ''
    const ctxNow = liveCtx(m)

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      const barW = Math.max(4, e.props.bodyColumns - 30)

      return (
        <Box flexDirection="column">
          <Text>
            <Text bold>{short(s.all)}</Text> tokens<Text dimColor>{cost}</Text>
          </Text>
          <Text dimColor>{sub}</Text>
          {KINDS.map(k => (
            <Text key={k.key}>
              <Text color={k.dark}>{'█'.repeat(Math.round((s.all ? s[k.key] / s.all : 0) * barW)) || '▏'}</Text> {k.label}{' '}
              {short(s[k.key])} <Text dimColor>{pct(s[k.key])}</Text>
            </Text>
          ))}
        </Box>
      )
    }

    const { Box, Text, Svg, Progress } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text dimColor>This chat</Text>
          <Text>
            <Text bold>{short(s.all)}</Text> tokens<Text dimColor>{cost}</Text>
          </Text>
          <Text dimColor>{sub}</Text>
        </Box>

        <Box flexDirection="column">
          {KINDS.map(k => (
            <Box key={k.key} flexDirection="row" justifyContent="space-between">
              <Text>
                <Text color={k.light}>■</Text> {k.label}
              </Text>
              <Text>
                {short(s[k.key])} <Text dimColor>{pct(s[k.key])}</Text>
              </Text>
            </Box>
          ))}
        </Box>

        {list.length === 0 ? (
          <Text dimColor>No responses counted yet.</Text>
        ) : (
          <Box flexDirection="column" gap={1}>
            <Box flexDirection="column">
              <Text bold>Running total</Text>
              <Svg
                source={cumulativeChart(list)}
                alt={`Running total of ${short(s.all)} tokens over ${list.length} responses`}
                width={W}
              />
            </Box>
            <Box flexDirection="column">
              <Text bold>New tokens per response</Text>
              <Svg
                source={perRequestChart(list, FRESH)}
                alt={`Cache write, input and output tokens of each of ${list.length} responses`}
                width={W}
              />
              <Text dimColor>
                Cache reads are left out here: they re-read the same chat each time and would hide the rest. Dashed
                lines mark where each of your prompts began.
              </Text>
            </Box>
          </Box>
        )}

        {ctxNow !== undefined && m.win ? (
          <Progress label={`Context window: ${short(ctxNow)} of ${short(m.win)}`} value={ctxNow} max={m.win} />
        ) : null}

        <Text dimColor>
          {m.source === 'transcript'
            ? "Counted from this chat's transcript (main chat, not subagents)."
            : 'Counted live since the panel loaded.'}
        </Text>
      </Box>
    )
  })
}
