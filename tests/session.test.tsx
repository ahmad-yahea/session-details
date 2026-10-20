import { expect, mock, test } from 'claude-code/testing'

test('the pane shows model, cost and limits with a reset countdown', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-20T10:00:00Z') })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.cwd', () => ({ value: '/work/app' }) as never)
  on('session.repo', () => ({ value: { root: '/work/app', remote: null, internal: false, name: 'app' } }) as never)
  on('session.turns', () => ({ value: 3 }) as never)
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }) as never)
  on('session.usage', () =>
    ({
      value: {
      startedAt: clock.now() - 125000,
      context: { window: 200000 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 42, resetsAt: '2026-10-20T12:14:00Z' },
        { kind: 'seven_day', percentUsed: 91.5, resetsAt: '2026-10-23T13:00:00Z' },
      ],
      cost: { usd: 0.42 },
      },
    }) as never,
  )

  await $.session.measure({
    context: { window: 200000 },
    rateLimits: [],
    changed: ['context'],
  } as never)

  const ui = await $.ui.mount({
    plugin: 'session-details',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'session-details',
    props: {
      title: 'Session',
      isFocused: false,
      bodyColumns: 44,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    } as never,
  })

  expect(await ui.find({ type: 'Button', text: /Limits/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /resets in 2h 14m/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /resets in 3d 3h/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\$0\.42/ })).toBeDefined()
  await ui.unmount()
})
