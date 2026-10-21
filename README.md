# session-details

A live side pane for Claude Code that shows what your session is doing, at a glance. It is the terminal version of the desktop app's session details sidebar.

It opens by itself when a session starts. `/session-details` reopens it.

## What it shows

Every section has a clickable `▾`/`▸` header that collapses it.

| Section | Shows |
| --- | --- |
| **Session** | The session's title, then model and effort, cost, number of turns, session age, repo or folder name |
| **Environment** | Whether Remote Control is connected, and to which surfaces |
| **Context** | `% used`, `used / max`, a segmented bar in each category's own colour, and tokens and % per category |
| **Limits** | The 5-hour, 7-day and spend windows: a bar, % used, and a live "resets in 2h 14m" countdown |
| **Outputs** | Files written this session (Write, NotebookEdit, Artifact), newest first |
| **Background tasks** | Running tasks with elapsed time, and a finished/failed count |
| **Subagents** | Every running subagent and a finished count |
| **MCP servers** | Every server with tools, how many of its tools are loaded, and the tokens those loaded tools take in context (deferred tools cost nothing until used) |
| **Scheduled** | Cron jobs and when they next run |

Subagents, MCP servers and Scheduled only appear when there is something to show.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install session-details --marketplace ahmad-yahea/session-details
```

From a shell:

```
claude plugin install session-details --marketplace ahmad-yahea/session-details
```

Answer `y` to add the marketplace, then pick a scope (user scope applies to every session). Install it once on each machine or profile you want it on.

## Requirements

- A Claude Code build that supports function-hook mods.
- A terminal wide enough to dock the pane (about 110 columns). On narrower terminals it opens above the prompt instead.
- Limits only appear on a subscription that reports them. Effort appears after your first prompt.

## How it works

The mod is a single hooks module (`hooks/register.tsx`). It reads session data from Claude Code's own `$.session`, `$.agent` and context-breakdown APIs and draws a `Pane`. It makes no network calls, writes no files and stores nothing outside the session.

## License

MIT
