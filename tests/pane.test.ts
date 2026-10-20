import { expect, mock, test } from 'claude-code/testing'

test('the pane draws every section on the terminal', async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('session.usage', () => ({
    context: {
      window: 200000,
      breakdown: {
        categories: [
          { name: 'System prompt', tokens: 8000, color: 'promptBorder', isDeferred: false, kind: 'used' },
          { name: 'Free space', tokens: 150000, color: 'inactive', isDeferred: false, kind: 'free' },
          { name: 'Web tools', tokens: 3000, color: 'permission', isDeferred: true, kind: 'deferred' },
        ],
        totalTokens: 8000,
        maxTokens: 200000,
        rawMaxTokens: 200000,
        percentage: 4,
      },
    },
  }) as never)

  const ui = await $.ui.mount({
    plugin: 'session-details',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'session-details',
    props: {
      title: 'Session',
      isFocused: false,
      bodyColumns: 40,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    } as never,
  })

  for (const re of [/Environment/, /Local terminal/, /Context/, /Outputs/, /Background tasks/]) {
    expect(await ui.find({ type: 'Text', text: re }) ?? (await ui.find({ type: 'Button', text: re }))).toBeDefined()
  }
  await ui.press({ key: 'toggle-outputs' })
  await ui.unmount()
})
