import { expect, mock, test } from 'claude-code/testing'

const PROPS = {
  title: 'Session',
  isFocused: false,
  bodyColumns: 48,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as never

test('the pane draws every section and collapses one', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const ui = await $.ui.mount({
    plugin: 'session-details',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'session-details',
    props: PROPS,
  })

  for (const title of ['Environment', 'Context', 'Outputs', 'Background tasks']) {
    expect(await ui.find({ type: 'Button', text: new RegExp(title) })).toBeDefined()
  }
  expect(await ui.find({ type: 'Text', text: /Local terminal/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Nothing written yet/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /No background tasks/ })).toBeDefined()

  await ui.press({ key: 'toggle-outputs' })
  expect(await ui.find({ type: 'Text', text: /Nothing written yet/ })).toBe(undefined)
  expect(await ui.find({ type: 'Button', text: /▸ Outputs/ })).toBeDefined()
})
