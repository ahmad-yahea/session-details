# session-details

A live side pane for Claude Code that shows what your session is doing, at a glance. It is the terminal version of the desktop app's session details sidebar.

In Claude Code's fullscreen layout it opens by itself as a sidebar beside the conversation. On the normal screen it stays out of the way until you type `/session-details`. It then opens compactly above the prompt, with only Session and Limits expanded, and redraws at most once a minute unless a task is running.

## What it shows

Every section has a clickable `▾`/`▸` header that collapses it.

| Section | Shows |
| --- | --- |
| **Session** | A title written from the whole conversation (renewed every 5 turns), then model and effort, cost, number of turns, session age, repo or folder name |
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

## Installed twice?

Only one copy ever runs. This can happen when the plugin is enabled at more than one scope, from two marketplaces, or alongside a `--plugin-dir` copy. Whichever copy loads first refuses the others, so you get one pane and one `/session-details`. The Environment section names each skipped copy (`⚠ duplicate skipped: …`) so you can uninstall the one you don't want. Installing at user scope keeps things simple.

## Session titles

After the first turn, the pane reads the whole conversation and asks Haiku, through your own Claude Code session, for a 3–7 word title describing the session as a whole. It renews the title every 5 turns as the work moves on. Until the first title is ready it shows the title Claude Code has, if any, else "Untitled session". Each title costs one small Haiku call.

## How it works

The mod is a single hooks module (`hooks/register.tsx`). It reads session data from Claude Code's own `$.session`, `$.agent` and context-breakdown APIs and draws a `Pane`. Apart from the small Haiku call that names the session, it makes no network calls of its own, writes no files and stores nothing outside the session.

## License

MIT
