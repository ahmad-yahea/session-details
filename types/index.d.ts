export type ContextRow = {
  name: string
  tokens: number
  color: string
  kind: 'used' | 'free' | 'buffer' | 'deferred'
}

export type ContextView = {
  categories: ContextRow[]
  totalTokens: number
  rawMaxTokens: number
  percentage: number
}

export type TaskStatus = 'running' | 'completed' | 'failed' | 'stopped'

export type BackgroundTask = {
  id: string
  label: string
  startedAt: number
  status: TaskStatus
}

export type SessionView = {
  model: string
  cwd: string
  repo: string | null
  turns: number
  startedAt: number
  costUsd: number | null
}

export type LimitView = { kind: string; percentUsed: number; resetsAt?: string }

export type AgentView = { id: string; description: string; type: string; status: string }

export type McpView = { server: string; tools: number; tokens: number }

export type CronView = { id: string; schedule: string; prompt: string; nextFireAt?: number }

export type EnvView = { surfaces: string[] }

declare module 'claude-code' {
  interface PluginState {
    'session-details': {
      collapsed: Record<string, boolean>
      env: EnvView
      context: ContextView | null
      outputs: string[]
      tasks: BackgroundTask[]
      now: number
      session: SessionView | null
      effort: string | null
      limits: LimitView[]
      agents: AgentView[]
      mcp: McpView[]
      crons: CronView[]
    }
  }
}
