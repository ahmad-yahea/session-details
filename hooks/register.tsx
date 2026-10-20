import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentView, BackgroundTask, ContextView, CronView, LimitView } from '../types'
import {
  backgroundId,
  barRuns,
  basename,
  clip,
  fmtElapsed,
  fmtPercent,
  fmtResetIn,
  fmtTokens,
  fmtUsd,
  limitColor,
  limitLabel,
  mcpServers,
  meterCells,
  outputPath,
  parseNotifications,
  pushOutput,
  taskLabel,
  textOf,
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
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'session-details',
      description: 'Open the session details pane',
    })
    void $.ui.open({ id: PANE, title: 'Session' })
    await Promise.all([
      refreshEnv($),
      refreshContext($),
      refreshSession($),
      refreshAgents($),
      refreshCrons($),
    ])

    // Ticks only redraw while something runs.
    $.clock.every(1000, async () => {
      const hasAgents = (await read($, agents)).some(a => a.status === 'running')
      if (hasAgents) await refreshAgents($)
      const isTimed =
        hasAgents ||
        (await read($, tasks)).some(isRunning) ||
        (await read($, limits)).some(l => l.resetsAt !== undefined)
      if (isTimed) {
        const at = await $.clock.now()
        await update($, now, () => at)
      }
    })

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
    const windows = await read($, limits)
    const subagents = await read($, agents)
    const servers = await read($, mcp)
    const jobs = await read($, crons)

    const header = (id: string, title: string) => (
      <Button
        key={`toggle-${id}`}
        label={`${fold[id] ? '▸' : '▾'} ${title}`}
        onPress={() => update($, collapsed, m => ({ ...m, [id]: !m[id] }))}
      />
    )

    const remote = surfaces.filter(s => s !== 'terminal')
    const environment =
      remote.length > 0 ? (
        <Text color="success">{clip(`● Remote Control · ${remote.join(', ')}`, width)}</Text>
      ) : (
        <Text dimColor>{clip('○ Local terminal · /remote-control to connect', width)}</Text>
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
          <Text>{clip(`${info.model} · effort ${level ?? '—'}`, width)}</Text>
          <Text dimColor>{clip(facts.join(' · '), width)}</Text>
          <Text dimColor>{clip(`▤ ${info.repo ?? basename(info.cwd)}`, width)}</Text>
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
          {running.slice(0, 5).map(a => (
            <Text>{clip(`▶ ${a.description || a.type}`, width)}</Text>
          ))}
          {running.length > 5 && <Text dimColor>{`+${running.length - 5} more`}</Text>}
          {done > 0 && <Text dimColor>{`◇ ${done} finished`}</Text>}
        </Box>
      )
    }

    const mcpBody = () => (
      <Box flexDirection="column">
        {servers.slice(0, 8).map(m => (
          <Text>{clip(`● ${m.server} · ${m.tools} tools · ${fmtTokens(m.tokens)}`, width)}</Text>
        ))}
        {servers.length > 8 && <Text dimColor>{`+${servers.length - 8} more`}</Text>}
      </Box>
    )

    const cronsBody = () => (
      <Box flexDirection="column">
        {jobs.slice(0, 5).map(j => {
          const next = fmtResetIn(j.nextFireAt, clock)

          return (
            <Text>
              {clip(`⏱ ${j.schedule}${next ? ` · in ${next}` : ''} · ${j.prompt}`, width)}
            </Text>
          )
        })}
        {jobs.length > 5 && <Text dimColor>{`+${jobs.length - 5} more`}</Text>}
      </Box>
    )

    const section = (id: string, title: string, body: () => ReturnType<typeof tasksBody>) => (
      <Box flexDirection="column">
        {header(id, title)}
        {!fold[id] && body()}
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
