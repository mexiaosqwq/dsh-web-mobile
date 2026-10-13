// Scenario-only startup preparation; does not change product behavior or baselines.
// A fresh profile shows a notice asynchronously. Use its own Continue action;
// removing only aria-modal leaves a mask that steals every touch hit-test.
export async function prepareHostScenario(evaluate, { timeoutMs = 10000 } = {}) {
  const started = Date.now()
  const deadline = started + timeoutMs
  let quietSince = null
  let last = null
  while (Date.now() < deadline) {
    last = await evaluate(`(() => {
      const modals = [...document.querySelectorAll('[aria-modal="true"]')]
      const dismissed = []
      for (const modal of modals) {
        const label = modal.getAttribute('aria-label')
        if (!['Preview Notice', 'Internal Testing Notice', 'Add an API key to get started'].includes(label)) continue
        const button = [...modal.querySelectorAll('button')].find(el =>
          label === 'Add an API key to get started'
            ? el.textContent.trim() === 'Configure later'
            : /^(Continue|继续|I understand|我已了解)$/i.test(el.textContent.trim()))
        if (!button) throw new Error('known startup notice has no recognized Continue action: ' + label)
        button.click()
        dismissed.push(label)
      }
      const input = document.querySelector('[data-composer-input]')
      return {
        ready: document.readyState === 'complete' && !!document.querySelector('[data-phase]'),
        modals: [...document.querySelectorAll('[aria-modal="true"]')].map(el => el.getAttribute('aria-label')),
        dismissed,
        composer: input ? { kind: input.tagName, editable: input.isContentEditable,
          phase: input.getAttribute('data-phase'), label: input.getAttribute('aria-label') } : null,
      }
    })()`)
    if (last.ready && last.modals.length === 0) {
      quietSince ??= Date.now()
      // The 3s startup window covers the observed delayed Preview Notice mount.
      // A later/unrecognized modal still fails the scenario instead of being removed.
      if (Date.now() - started >= 3000 && Date.now() - quietSince >= 400) {
        console.log('PRECONDITION ' + JSON.stringify(last))
        return last
      }
    } else quietSince = null
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('host scenario precondition timed out: ' + JSON.stringify(last))
}
