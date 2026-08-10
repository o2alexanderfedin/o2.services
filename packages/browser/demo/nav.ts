/**
 * The demo page's in-page navigation and its view toggle. No framework, no router.
 *
 * ## Why the hash is the only state
 *
 * A click sets `location.hash`; everything that shows or hides a panel reads it back.
 * That is one variable rather than two, so a deep link, the back button and a click all
 * take the same path — and there is no second copy of "which surface is on screen" to
 * fall out of step with the first. {@link installNav} registers a `hashchange` listener
 * for the deep-link and back-button cases; a click writes the hash and then calls the
 * same renderer synchronously, which is a read OF the hash rather than a second source
 * of truth for it.
 *
 * **The synchronous call is not belt-and-braces.** `hashchange` is queued as a task, and
 * `demo-viewport.e2e.test.ts` clicks a tab and then waits exactly one
 * `requestAnimationFrame` before it measures. A renderer that only ran on the queued
 * event would sometimes be measured before it had run, which is the class of flake that
 * gets a geometry spec deleted rather than fixed.
 *
 * ## What may never be hidden
 *
 * {@link installViewToggle} has two positions and neither of them hides a text view.
 * `attestation-ui.e2e.test.ts` asserts `isVisible('#run-report')` after a run; a toggle
 * able to hide it would make that guard pass or fail on whichever state a test happened
 * to land in, which is a guard that has stopped guarding. The toggle collapses
 * `.rendered-only` and nothing else, and the CSS carries the same note beside the rule.
 *
 * Both functions are idempotent and both are safe to call before `#main` is shown — they
 * touch attributes only, and `[hidden] { display: none !important }` in `demo.css` is
 * what turns the attribute into an absence from the screen.
 */

/** The six surfaces, in tab order. The hash form is `#/<name>`. */
const SURFACES = ['colouring', 'primes', 'pi', 'byo', 'fabric', 'bench'] as const

type Surface = (typeof SURFACES)[number]

/**
 * Colouring, because `colouring-demo.e2e.test.ts` and `attestation-ui.e2e.test.ts`
 * locator-click `#run` and `#verify` without navigating, and a locator click requires an
 * actionable element. Beyond the guards: it is the workload the page opens by explaining.
 */
const DEFAULT_SURFACE: Surface = 'colouring'

/** Where the view toggle remembers itself. Session, not local: a preference for this visit. */
const VIEW_KEY = 'o2:view-mode'

type View = 'both' | 'text'

function isSurface(value: string): value is Surface {
  return (SURFACES as readonly string[]).includes(value)
}

/** An unknown or empty hash selects Colouring rather than showing nothing at all. */
function surfaceFromHash(hash: string): Surface {
  const name = hash.replace(/^#\/?/, '')
  return isSurface(name) ? name : DEFAULT_SURFACE
}

function tabElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('nav#surfaces [role="tab"]'))
}

/** `nav-pi` -> `pi`. The ids are the contract; UI-SPEC section 2.1 fixes both halves. */
function surfaceOf(tab: HTMLElement): Surface {
  const name = tab.id.replace(/^nav-/, '')
  return isSurface(name) ? name : DEFAULT_SURFACE
}

/**
 * Render the tab strip and the panels from `location.hash`.
 *
 * Roving `tabindex`: exactly one tab is in the document's tab order, so Tab moves past
 * the strip rather than through six controls, and the arrow keys move within it.
 */
function render(): void {
  const current = surfaceFromHash(window.location.hash)
  for (const name of SURFACES) {
    const tab = document.getElementById(`nav-${name}`)
    const panel = document.getElementById(`s-${name}`)
    const selected = name === current
    if (tab !== null) {
      tab.setAttribute('aria-selected', selected ? 'true' : 'false')
      tab.setAttribute('tabindex', selected ? '0' : '-1')
    }
    if (panel !== null) panel.hidden = !selected
  }
}

/** Move selection AND focus — selection follows focus, per UI-SPEC section 2.1. */
function focusTab(index: number): void {
  const tabs = tabElements()
  if (tabs.length === 0) return
  const wrapped = ((index % tabs.length) + tabs.length) % tabs.length
  const tab = tabs[wrapped]
  if (tab === undefined) return
  window.location.hash = `#/${surfaceOf(tab)}`
  render()
  tab.focus()
}

/** Install the hash-driven tab strip. Idempotent; safe to call before #main is shown. */
export function installNav(): void {
  const nav = document.getElementById('surfaces')
  if (nav === null) return
  if (nav.dataset['installed'] === 'yes') {
    render()
    return
  }
  nav.dataset['installed'] = 'yes'

  const tabs = tabElements()
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => {
      window.location.hash = `#/${surfaceOf(tab)}`
      render()
    })
    tab.addEventListener('keydown', (event: KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault()
          focusTab(index - 1)
          break
        case 'ArrowRight':
          event.preventDefault()
          focusTab(index + 1)
          break
        case 'Home':
          event.preventDefault()
          focusTab(0)
          break
        case 'End':
          event.preventDefault()
          focusTab(tabs.length - 1)
          break
        case 'Enter':
        case ' ':
          event.preventDefault()
          focusTab(index)
          break
        default:
          break
      }
    })
  }

  // The deep-link and back-button path. One listener, and it reads the same hash the
  // click handler above just wrote.
  window.addEventListener('hashchange', render)
  render()
}

/** Install the two-position view toggle. Persists to sessionStorage; sets data-view on #main. */
export function installViewToggle(): void {
  const main = document.getElementById('main')
  const control = document.getElementById('view-mode')
  if (main === null || control === null) return
  if (control.dataset['installed'] === 'yes') return
  control.dataset['installed'] = 'yes'

  const apply = (view: View): void => {
    main.dataset['view'] = view
    for (const input of Array.from(
      control.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    )) {
      input.checked = input.value === view
    }
    // A private window can refuse storage outright. A remembered preference is worth
    // less than a page that renders, so the refusal is swallowed rather than surfaced.
    try {
      window.sessionStorage.setItem(VIEW_KEY, view)
    } catch {
      /* storage refused — the toggle still works for this page load */
    }
  }

  control.addEventListener('change', (event: Event) => {
    const target = event.target
    if (!(target instanceof HTMLInputElement)) return
    apply(target.value === 'text' ? 'text' : 'both')
  })

  let stored: string | null = null
  try {
    stored = window.sessionStorage.getItem(VIEW_KEY)
  } catch {
    stored = null
  }
  apply(stored === 'text' ? 'text' : 'both')
}
