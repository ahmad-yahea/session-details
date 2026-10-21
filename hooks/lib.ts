import type { ContextRow, McpView, SkippedCopy, TaskStatus } from '../types'

type Rec = Record<string, unknown>

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v !== '' ? v : undefined

/** 160300 -> "160.3k", 1000000 -> "1M", 950 -> "950". */
export function fmtTokens(n: number): string {
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, '')
  if (n < 1000) return String(Math.max(0, Math.round(n)))
  const k = Math.round(n / 100) / 10
  if (k < 1000) return `${trim(k)}k`
  return `${trim(n / 1e6)}M`
}

/** 12s, 2m 03s, 1h 02m. */
export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const two = (x: number) => String(x).padStart(2, '0')
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${two(s % 60)}s`
  return `${Math.floor(s / 3600)}h ${two(Math.floor((s % 3600) / 60))}m`
}

export function fmtPercent(tokens: number, max: number): string {
  if (max <= 0) return '0.0%'
  return `${((tokens / max) * 100).toFixed(1)}%`
}

export const basename = (path: string): string =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path

/** Cut to `width` cells with an ellipsis; one line. */
export function clip(text: string, width: number): string {
  const one = text.replace(/\s+/g, ' ').trim()
  if (width <= 0) return ''
  return one.length <= width ? one : `${one.slice(0, Math.max(0, width - 1))}…`
}

/**
 * The runs of the segmented bar: one per used category, in order, sized by
 * cumulative rounding so the runs never overshoot `width`; `rest` is the ░ tail.
 */
export function barRuns(
  categories: readonly ContextRow[],
  max: number,
  width: number,
): { runs: { color: string; n: number }[]; rest: number } {
  const runs: { color: string; n: number }[] = []
  if (max <= 0 || width <= 0) return { runs, rest: Math.max(0, width) }
  let cum = 0
  let drawn = 0
  for (const c of categories) {
    if (c.kind !== 'used') continue
    cum += c.tokens
    const end = Math.min(width, Math.round((cum / max) * width))
    const n = end - drawn
    if (n > 0) runs.push({ color: c.color, n })
    drawn = Math.max(drawn, end)
  }
  return { runs, rest: width - drawn }
}

/** Where a main-thread write tool put its file. */
export function outputPath(tool: string, input: unknown): string | undefined {
  if (!isRec(input)) return undefined
  if (tool === 'Write' || tool === 'Artifact') return str(input.file_path)
  if (tool === 'NotebookEdit') return str(input.notebook_path)
  return undefined
}

/** Newest first, no repeats. */
export const pushOutput = (list: readonly string[], path: string): string[] =>
  [path, ...list.filter(p => p !== path)].slice(0, 100)

/** The id of the background task a tool call started, if it started one. */
export function backgroundId(tool: string, result: unknown): string | undefined {
  if (!isRec(result)) return undefined
  if (tool === 'Bash') return str(result.backgroundTaskId)
  if (tool === 'Agent') {
    if (result.status === 'async_launched') return str(result.agentId)
    if (result.status === 'remote_launched') return str(result.taskId)
    return undefined
  }
  return str(result.taskId)
}

/** What the user would call the task: description, command, then prompt. */
export function taskLabel(input: unknown): string {
  if (!isRec(input)) return 'task'
  return str(input.description) ?? str(input.command) ?? str(input.prompt) ?? 'task'
}

export function statusOf(raw: string): Exclude<TaskStatus, 'running'> {
  const s = raw.trim().toLowerCase()
  if (/fail|error/.test(s)) return 'failed'
  if (/kill|stop/.test(s)) return 'stopped'
  return 'completed'
}

/** Every `<task-id>` with its `<status>` in the text of a row. */
export function parseNotifications(
  text: string,
): { id: string; status: Exclude<TaskStatus, 'running'> }[] {
  const out: { id: string; status: Exclude<TaskStatus, 'running'> }[] = []
  const chunks = text.includes('<task-notification')
    ? text.split(/<task-notification\b/).slice(1)
    : [text]
  for (const chunk of chunks) {
    const id = /<task-id>\s*([^<]+?)\s*<\/task-id>/.exec(chunk)?.[1]
    if (!id) continue
    const status = /<status>([^<]*)<\/status>/.exec(chunk)?.[1] ?? ''
    out.push({ id, status: statusOf(status) })
  }
  return out
}

/** The text blocks of a row's content. */
export function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(b => (isRec(b) && b.type === 'text' && typeof b.text === 'string' ? b.text : ''))
    .filter(Boolean)
    .join('\n')
}

export const fmtUsd = (n: number): string =>
  n >= 100 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`

/** "2d 3h", "2h 14m", "14m", "now" until an ISO instant or epoch ms. */
export function fmtResetIn(resetsAt: string | number | undefined, nowMs: number): string {
  if (resetsAt === undefined) return ''
  const at = typeof resetsAt === 'number' ? resetsAt : Date.parse(resetsAt)
  if (Number.isNaN(at)) return ''
  const min = Math.ceil((at - nowMs) / 60000)
  if (min <= 0) return 'now'
  if (min < 60) return `${min}m`
  if (min < 1440) return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`
  return `${Math.floor(min / 1440)}d ${Math.floor((min % 1440) / 60)}h`
}

export function limitLabel(kind: string): string {
  if (kind === 'five_hour') return '5-hour'
  if (kind === 'seven_day') return '7-day'
  if (kind === 'spend_limit') return 'Spend'
  return kind.replace(/_/g, ' ')
}

/** A ▰/▱ meter: how many cells are filled for a 0-100+ percentage. */
export function meterCells(percent: number, width: number): { filled: number; empty: number } {
  const w = Math.max(0, width)
  const filled = Math.min(w, Math.max(0, Math.round((percent / 100) * w)))
  return { filled, empty: w - filled }
}

/** success below 70%, warning below 90%, error from there. */
export const limitColor = (percent: number): 'success' | 'warning' | 'error' =>
  percent >= 90 ? 'error' : percent >= 70 ? 'warning' : 'success'

/**
 * MCP tools grouped by server. `tokens` counts only the loaded schemas: a
 * deferred tool sits outside the window until it is searched for.
 * Biggest context cost first, then by name.
 */
export function mcpServers(
  tools: readonly { serverName: string; tokens: number; isLoaded: boolean }[],
): McpView[] {
  const by = new Map<string, McpView>()
  for (const t of tools) {
    const one = by.get(t.serverName) ?? { server: t.serverName, tools: 0, loaded: 0, tokens: 0 }
    one.tools += 1
    if (t.isLoaded) {
      one.loaded += 1
      one.tokens += t.tokens
    }
    by.set(t.serverName, one)
  }
  return [...by.values()].sort((a, b) => b.tokens - a.tokens || a.server.localeCompare(b.server))
}

/**
 * The copy a loading module would duplicate, or null: same plugin name from
 * another folder. Its own folder is a reload, never a duplicate.
 */
export function duplicateOf(
  self: { name: string; root: string },
  loading: { name: string; root: string; provenance: string; version?: string },
): SkippedCopy | null {
  if (loading.name !== self.name || loading.root === self.root) return null
  return { provenance: loading.provenance, root: loading.root, version: loading.version ?? null }
}

/** How often, in user turns, a generated title is written again. */
export const RETITLE_EVERY = 5

/** Whether a title is due: none yet, or RETITLE_EVERY turns since the last. */
export function titleDue(last: { turns: number } | null, turns: number): boolean {
  if (turns < 1) return false
  return last === null || turns - last.turns >= RETITLE_EVERY
}

/**
 * The whole conversation as one compact text for naming it: every message,
 * the person's clipped longer than Claude's, tool names kept. Past `cap`
 * characters the opening (where the goal is stated) and the latest work are
 * kept and the middle is cut.
 */
export function titleDigest(
  messages: readonly { role: 'user' | 'assistant'; text: string; toolUses?: readonly { tool: string }[] }[],
  cap = 12000,
): string {
  const lines: string[] = []
  for (const m of messages) {
    const text = m.text.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const tools = (m.toolUses ?? []).map(t => t.tool).filter(Boolean)
    if (!text && tools.length === 0) continue
    const who = m.role === 'user' ? 'User' : 'Claude'
    const body = clip(text, m.role === 'user' ? 400 : 200)
    lines.push(`${who}: ${body}${tools.length ? ` [tools: ${[...new Set(tools)].join(', ')}]` : ''}`)
  }
  const all = lines.join('\n')
  if (all.length <= cap) return all
  const head = Math.floor(cap * 0.35)
  return `${all.slice(0, head)}\n…\n${all.slice(all.length - (cap - head))}`
}

/** A model's reply as a title: first line, no quotes or label, no end stop. */
export function cleanTitle(raw: string): string {
  const line = (raw.split('\n').find(l => l.trim()) ?? '').trim()
  return clip(
    line
      .replace(/^(title|session title)\s*:\s*/i, '')
      .replace(/^["'`*_]+|["'`*_]+$/g, '')
      .replace(/[.!?:;,]+$/, '')
      .trim(),
    70,
  )
}
