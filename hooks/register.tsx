import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentView, BackgroundTask, ContextView, CronView, LimitView } from '../types'
import {
  backgroundId,
  barRuns,
  basename,
  cleanTitle,
  clip,
  duplicateOf,
  fmtElapsed,
  fmtPercent,
  fmtResetIn,
  fmtTokens,
  fmtUsd,
  isFolded,
  limitColor,
  limitLabel,
  mcpServers,
  meterCells,
  outputPath,
  parseNotifications,
  pushOutput,
  taskLabel,
  textOf,
  tickRedraws,
  titleDigest,
  titleDue,
} from './lib'

const PANE = 'session-details'
const MAX_OUTPUTS = 8

const collapsed = atom({ plugin: 'session-details', key: 'collapsed' } as const, {})
const env = atom({ plugin: 'session-details', key: 'env' } as const, { surfaces: [] })
const context = atom({ plugin: 'session-details', key: 'context' } as const, null)
const outputs = atom({ plugin: 'session-details', key: 'outputs' } as const, [])
const tasks = atom({ plugin: 'session-details', key: 'tasks' } as const, [])
const now = atom({ plugin: 'session-details', key: 'now' } as const, 0)
const session = atom({ plugin: 'session-details', key: 'session' } as const, null)
const effort = atom({ plugin: 'session-details', key: 'effort' } as const, null)
const title = atom({ plugin: 'session-details', key: 'title' } as const, null)
const skipped = atom({ plugin: 'session-details', key: 'skipped' } as const, [])
const autoTitle = atom({ plugin: 'session-details', key: 'autoTitle' } as const, null)
const limits = atom({ plugin: 'session-details', key: 'limits' } as const, [])
const agents = atom({ plugin: 'session-details', key: 'agents' } as const, [])
const mcp = atom({ plugin: 'session-details', key: 'mcp' } as const, [])
const crons = atom({ plugin: 'session-details', key: 'crons' } as const, [])

const isRunning = (t: BackgroundTask) => t.status === 'running'

async function refreshEnv($: EngineInterface) {
  try {
    const surfaces = [...(await $.session.surfaces())]
    await update($, env, () => ({ surfaces }))
  } catch {}
}

async function refreshSession($: EngineInterface) {
  try {
    const [model, cwd, repo, turns, usage, at] = await Promise.all([
      $.session.model(),
      $.session.cwd(),
      $.session.repo(),
      $.session.turns(),
      $.session.usage(),
      $.clock.now(),
    ])
    await update($, session, () => ({
      model,
      cwd,
      repo: repo?.name ?? null,
      turns,
      startedAt: usage.startedAt,
      costUsd: usage.cost?.usd ?? null,
    }))
    const windows: LimitView[] = usage.rateLimits.map(r => ({
      kind: r.kind,
      percentUsed: r.percentUsed,
      resetsAt: r.resetsAt,
    }))
    await update($, limits, () => windows)
    await update($, now, () => at)
  } catch {}
}

async function noteTitle($: EngineInterface, value: string | undefined) {
  try {
    const name = value?.trim()
    if (name) await update($, title, () => name)
  } catch {}
}

const TITLE_SYSTEM =
  'You name coding sessions. Read the whole conversation and reply with only a title of 3 to 7 words ' +
  'in Title Case that says what the session as a whole is about: its main goal and the work done, ' +
  'not just the latest message. No quotes, no trailing punctuation, nothing else.'

let isNaming = false

/** Names the session from its whole conversation, when one is due. */
async function nameSession($: EngineInterface) {
  if (isNaming) return
  isNaming = true
  try {
    const turns = await $.session.turns()
    if (!titleDue(await read($, autoTitle), turns)) return
    const digest = titleDigest(await $.session.messages())
    if (!digest) return
    const reply = await $.model.complete({
      model: 'haiku',
      system: TITLE_SYSTEM,
      prompt: `The conversation:\n\n${digest}\n\nTitle:`,
      maxTokens: 30,
      timeoutMs: 30000,
    })
    if (!reply.isAnswered) return
    const text = cleanTitle(reply.text)
    if (text) await update($, autoTitle, () => ({ text, turns }))
  } catch {
  } finally {
    isNaming = false
  }
}

async function refreshAgents($: EngineInterface) {
  try {
    const list: AgentView[] = (await $.agent.list()).map(a => ({
      id: a.id,
      description: a.description,
      type: a.type,
      status: a.status,
    }))
    await update($, agents, () => list)
  } catch {}
}

async function refreshCrons($: EngineInterface) {
  try {
    const ran = await $.tool.call({ tool: 'CronList' })
    const result = ran.result as { jobs?: { id: string; humanSchedule: string; prompt: string; nextFireAt?: number }[] } | undefined
    const list: CronView[] = (result?.jobs ?? []).map(j => ({
      id: j.id,
      schedule: j.humanSchedule,
      prompt: j.prompt,
      nextFireAt: j.nextFireAt,
    }))
    await update($, crons, () => list)
  } catch {}
}

async function refreshContext($: EngineInterface) {
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    const b = usage.context.breakdown
    if (!b) return
    const view: ContextView = {
      categories: b.categories.map(c => ({
        name: c.name,
        tokens: c.tokens,
        color: c.color,
        kind: c.kind,
      })),
      totalTokens: b.totalTokens,
      rawMaxTokens: b.rawMaxTokens,
      percentage: b.percentage,
    }
    await update($, context, () => view)
    await update($, mcp, () => mcpServers(b.mcpTools))
  } catch {}
}

export const register: Register = on => {
  // One copy per session: a second session-details (another scope, a
  // --plugin-dir, another marketplace) would register the same command and
  // pane. The copy already loaded refuses any other folder's; its own folder
  // is a reload and passes. A failing guard lets the newcomer load.
  on('plugin.register', async ($, e, next) => {
    const copy = duplicateOf({ name: $.plugin.name, root: $.plugin.root }, e)
    if (!copy) return next(e)
    await update($, skipped, list => [...list.filter(s => s.root !== copy.root), copy])

    return {
      refuse: `${$.plugin.name} is already loaded from ${$.plugin.root}; skipped the copy at ${e.root}`,
    }
  }).catch(($, e, next) => next(e))

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'session-details',
      description: 'Open the session details pane',
    })
    await Promise.all([
      refreshEnv($),
      refreshContext($),
      refreshSession($),
      refreshAgents($),
      refreshCrons($),
    ])
    void nameSession($)

    // Ticks only redraw while something runs.
    $.clock.every(1000, async () => {
      const hasAgents = (await read($, agents)).some(a => a.status === 'running')
      if (hasAgents) await refreshAgents($)
      const isBusy = hasAgents || (await read($, tasks)).some(isRunning)
      const hasCountdown =
        (await read($, limits)).some(l => l.resetsAt !== undefined) ||
        (await read($, crons)).some(c => c.nextFireAt !== undefined)
      const at = await $.clock.now()
      if (tickRedraws(isBusy, hasCountdown, await read($, now), at)) {
        await update($, now, () => at)
      }
    })

    return next(e)
  })

  // Opened unasked only where the terminal docks it beside the transcript
  // (the fullscreen layout). On the main screen it would sit inline above the
  // prompt and push the conversation around, so there /session-details opens it.
  let isOffered = false
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!isOffered && e.viewport?.isFullscreen === true) {
      isOffered = true
      void $.ui.open({ id: PANE, title: 'Session' })
    }

    return next(e)
  })

  on('command.run', { command: 'session-details' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Session' })

    return { text: 'Session details pane opened.' }
  })

  on('session.attach', async ($, e, next) => {
    const ran = await next(e)
    await refreshEnv($)

    return ran
  })

  on('session.detach', async ($, e, next) => {
    const ran = await next(e)
    await refreshEnv($)

    return ran
  })

  on('session.measure', async ($, e, next) => {
    const ran = await next(e)
    await Promise.all([refreshContext($), refreshSession($)])

    return ran
  })

  // The title rides only on the classic SessionStart and UserPromptSubmit
  // inputs: set at start or resume, and kept current as each prompt goes in.
  on('classic.SessionStart', async ($, e, next) => {
    const ran = await next(e)
    await noteTitle($, e.session_title)

    return ran
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const ran = await next(e)
    await noteTitle($, e.session_title)

    return ran
  })

  on('turn.step', async function* ($, e, next) {
    try {
      if (e.agentId === undefined) {
        const level = e.effort === undefined ? null : String(e.effort)
        await update($, effort, () => level)
      }
    } catch {}

    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    await Promise.all([refreshSession($), refreshAgents($), refreshCrons($)])
    if (e.agentId === undefined) void nameSession($)

    return ran
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    try {
      if (ran.result === undefined || ran.isError) return ran
      const input: unknown = e
      const at = await $.clock.now()

      if (e.agentId === undefined) {
        const path = outputPath(e.tool, input)
        if (path) await update($, outputs, list => pushOutput(list, path))
      }

      const id = backgroundId(e.tool, ran.result)
      if (id) {
        const task: BackgroundTask = {
          id,
          label: taskLabel(input),
          startedAt: at,
          status: 'running',
        }
        await update($, tasks, list => [...list.filter(t => t.id !== id), task].slice(-200))
        await update($, now, () => at)
      }

      if (e.tool === 'TaskStop') {
        const stopped = (input as { task_id?: unknown }).task_id
        if (typeof stopped === 'string') {
          await update($, tasks, list =>
            list.map(t => (t.id === stopped && isRunning(t) ? { ...t, status: 'stopped' } : t)),
          )
        }
      }
    } catch {}

    return ran
  })

  on('session.append', async ($, e, next) => {
    const ran = await next(e)
    try {
      const text = textOf(e.message.content)
      if (text.includes('<task-id>')) {
        const done = parseNotifications(text)
        if (done.length > 0) {
          await update($, tasks, list =>
            list.map(t => {
              const hit = done.find(d => d.id === t.id)

              return hit && isRunning(t) ? { ...t, status: hit.status } : t
            }),
          )
        }
      }
    } catch {}

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const width = Math.max(10, e.props.bodyColumns)
    const fold = await read($, collapsed)
    const surfaces = (await read($, env)).surfaces
    const ctx = await read($, context)
    const files = await read($, outputs)
    const list = await read($, tasks)
    const clock = await read($, now)
    const info = await read($, session)
    const level = await read($, effort)
    const name = (await read($, autoTitle))?.text ?? (await read($, title))
    const dupes = await read($, skipped)
    const windows = await read($, limits)
    const subagents = await read($, agents)
    const servers = await read($, mcp)
    const jobs = await read($, crons)

    const placement = e.props.placement
    const folded = (id: string) => isFolded(fold, id, placement)

    const header = (id: string, title: string) => (
      <Button
        key={`toggle-${id}`}
        label={`${folded(id) ? '▸' : '▾'} ${title}`}
        onPress={() => update($, collapsed, m => ({ ...m, [id]: !isFolded(m, id, placement) }))}
      />
    )

    const remote = surfaces.filter(s => s !== 'terminal')
    const connection =
      remote.length > 0 ? (
        <Text color="success">{clip(`● Remote Control · ${remote.join(', ')}`, width)}</Text>
      ) : (
        <Text dimColor>{clip('○ Local terminal · /remote-control to connect', width)}</Text>
      )
    const environment = (
      <Box flexDirection="column">
        {connection}
        {dupes.map(d => (
          <Text color="warning">
            {clip(`⚠ duplicate skipped: ${d.provenance}${d.version ? ` v${d.version}` : ''}`, width)}
          </Text>
        ))}
      </Box>
    )

    const contextBody = () => {
      if (!ctx) return <Text dimColor>No context data yet.</Text>
      const max = ctx.rawMaxTokens
      const { runs, rest } = barRuns(ctx.categories, max, width)
      const numW = 7
      const pctW = 7
      const nameW = Math.max(4, width - 2 - numW - pctW)
      const shown = ctx.categories.filter(c => c.kind !== 'deferred')
      const deferred = ctx.categories.filter(c => c.kind === 'deferred')
      const row = (c: (typeof ctx.categories)[number]) => {
        const isDeferred = c.kind === 'deferred'
        const mark = c.kind === 'free' ? '□' : '■'
        const pct = isDeferred ? '—' : fmtPercent(c.tokens, max)
        const rest = `${clip(c.name, nameW).padEnd(nameW)}${fmtTokens(c.tokens).padStart(numW)}${pct.padStart(pctW)}`

        return isDeferred ? (
          <Text dimColor>{`${mark} ${rest}`}</Text>
        ) : (
          <Text>
            <Text color={c.color}>{mark}</Text>
            {` ${rest}`}
          </Text>
        )
      }

      return (
        <Box flexDirection="column">
          <Box width={width} justifyContent="space-between">
            <Text>{`${Math.round(ctx.percentage)}% used`}</Text>
            <Text>{`${fmtTokens(ctx.totalTokens)} / ${fmtTokens(max)}`}</Text>
          </Box>
          <Text>
            {runs.map(r => (
              <Text color={r.color}>{'█'.repeat(r.n)}</Text>
            ))}
            <Text dimColor>{'░'.repeat(rest)}</Text>
          </Text>
          {shown.map(row)}
          {deferred.map(row)}
        </Box>
      )
    }

    const outputsBody = () => {
      if (files.length === 0) return <Text dimColor>Nothing written yet.</Text>
      const more = files.length - MAX_OUTPUTS

      return (
        <Box flexDirection="column">
          {files.slice(0, MAX_OUTPUTS).map(p => (
            <Text>{clip(`▤ ${basename(p)}`, width)}</Text>
          ))}
          {more > 0 && <Text dimColor>{`+${more} more`}</Text>}
        </Box>
      )
    }

    const tasksBody = () => {
      const running = list.filter(isRunning)
      const failed = list.filter(t => t.status === 'failed').length
      const finished = list.length - running.length
      if (list.length === 0) return <Text dimColor>No background tasks.</Text>

      return (
        <Box flexDirection="column">
          {running.map(t => {
            const age = fmtElapsed(clock - t.startedAt)
            const label = clip(t.label, Math.max(4, width - age.length - 4))

            return <Text>{`▶ ${label}  ${age}`}</Text>
          })}
          {finished > 0 &&
            (failed > 0 ? (
              <Text dimColor>
                {`◇ ${finished} finished`}
                <Text color="error">{` · ${failed} failed`}</Text>
              </Text>
            ) : (
              <Text dimColor>{`◇ ${finished} finished`}</Text>
            ))}
        </Box>
      )
    }

    const sessionBody = () => {
      if (!info) return <Text dimColor>No session data yet.</Text>
      const facts = [
        info.costUsd === null ? '' : fmtUsd(info.costUsd),
        `${info.turns} ${info.turns === 1 ? 'turn' : 'turns'}`,
        fmtElapsed(clock - info.startedAt),
      ].filter(Boolean)

      return (
        <Box flexDirection="column">
          {name ? (
            <Text bold>{clip(name, width)}</Text>
          ) : (
            <Text dimColor italic>
              {clip('Untitled session', width)}
            </Text>
          )}
          <Box flexDirection="column" marginTop={1}>
            <Box>
              <Box width={8}>
                <Text dimColor>Model</Text>
              </Box>
              <Text>{clip(info.model, Math.max(4, width - 8))}</Text>
            </Box>
            <Box>
              <Box width={8}>
                <Text dimColor>Effort</Text>
              </Box>
              <Text>{level ?? '—'}</Text>
            </Box>
            <Text dimColor>{clip(facts.join(' · '), width)}</Text>
            <Text dimColor>{clip(`▤ ${info.repo ?? basename(info.cwd)}`, width)}</Text>
          </Box>
        </Box>
      )
    }

    const limitsBody = () => {
      if (windows.length === 0) return <Text dimColor>No limit data.</Text>
      const labelW = 7
      const pctW = 5
      const barW = Math.max(4, width - labelW - pctW - 2)

      return (
        <Box flexDirection="column">
          {windows.map(w => {
            const { filled, empty } = meterCells(w.percentUsed, barW)
            const reset = fmtResetIn(w.resetsAt, clock)

            return (
              <Box flexDirection="column">
                <Text>
                  {limitLabel(w.kind).padEnd(labelW)}
                  <Text color={limitColor(w.percentUsed)}>{'▰'.repeat(filled)}</Text>
                  <Text dimColor>{'▱'.repeat(empty)}</Text>
                  {` ${Math.round(w.percentUsed)}%`.padStart(pctW + 1)}
                </Text>
                {reset !== '' && (
                  <Text dimColor>{clip(`${' '.repeat(labelW)}resets in ${reset}`, width)}</Text>
                )}
              </Box>
            )
          })}
        </Box>
      )
    }

    const running = subagents.filter(a => a.status === 'running' || a.status === 'waiting')
    const agentsBody = () => {
      const done = subagents.length - running.length

      return (
        <Box flexDirection="column">
          {running.map(a => (
            <Text>{clip(`▶ ${a.description || a.type}`, width)}</Text>
          ))}
          {done > 0 && <Text dimColor>{`◇ ${done} finished`}</Text>}
        </Box>
      )
    }

    const mcpBody = () => {
      const toolW = 8
      const tokW = 7
      const nameW = Math.max(4, width - 2 - toolW - tokW)
      const tools = servers.reduce((n, m) => n + m.tools, 0)
      const inContext = servers.reduce((n, m) => n + m.tokens, 0)

      return (
        <Box flexDirection="column">
          <Text dimColor>
            {clip(`${servers.length} servers · ${tools} tools · ${fmtTokens(inContext)} in context`, width)}
          </Text>
          <Text dimColor>{`${''.padEnd(nameW + 2)}${'loaded'.padStart(toolW)}${'tokens'.padStart(tokW)}`}</Text>
          {servers.map(m => {
            const row = `${clip(m.server, nameW).padEnd(nameW)}${`${m.loaded}/${m.tools}`.padStart(toolW)}${(m.loaded > 0 ? fmtTokens(m.tokens) : '—').padStart(tokW)}`

            return m.loaded > 0 ? (
              <Text>
                <Text color="success">●</Text>
                {` ${row}`}
              </Text>
            ) : (
              <Text dimColor>{`○ ${row}`}</Text>
            )
          })}
        </Box>
      )
    }

    const cronsBody = () => (
      <Box flexDirection="column">
        {jobs.map(j => {
          const next = fmtResetIn(j.nextFireAt, clock)

          return (
            <Text>
              {clip(`⏱ ${j.schedule}${next ? ` · in ${next}` : ''} · ${j.prompt}`, width)}
            </Text>
          )
        })}
      </Box>
    )

    const section = (id: string, title: string, body: () => ReturnType<typeof tasksBody>) => (
      <Box flexDirection="column">
        {header(id, title)}
        {!folded(id) && body()}
      </Box>
    )

    return (
      <Box flexDirection="column" width={width} gap={1}>
        {section('session', 'Session', sessionBody)}
        {section('environment', 'Environment', () => environment)}
        {section('context', 'Context', contextBody)}
        {section('limits', 'Limits', limitsBody)}
        {section('outputs', 'Outputs', outputsBody)}
        {section('tasks', 'Background tasks', tasksBody)}
        {subagents.length > 0 && section('agents', 'Subagents', agentsBody)}
        {servers.length > 0 && section('mcp', 'MCP servers', mcpBody)}
        {jobs.length > 0 && section('crons', 'Scheduled', cronsBody)}
      </Box>
    )
  })
}
