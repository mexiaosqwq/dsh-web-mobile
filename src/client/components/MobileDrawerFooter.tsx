import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconDownloadOutline16, IconPanelLeftOutline16, IconSparkle16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { NS } from '../i18n/locales.ts'
import { getFrame, MOBILE_QUERY } from '../effects/phone-chrome.ts'

/** Wire contract of the lifetime-token endpoint (host half, src/token-usage.ts). */
interface TokensTotalBody {
  ok?: boolean
  totalTokens?: number
}

/** Display state of the lifetime-token counter. */
type TokensState =
  | { status: 'loading' }
  | { status: 'loaded'; total: number }
  | { status: 'failed' }

/** Full props for the sidebar footer action entry. */
export interface MobileDrawerFooterProps extends PropsRuntime<'sidebar.footer.action'>, PropsLocale<typeof NS> {
  /** Bound ctx.sessionLogDownload.download() for the current session. */
  downloadSessionLog: (sessionId: string) => void
  /** Bound ctx.layout.toggleSidebar(): the Files sheet closes the drawer. */
  toggleSidebar: () => void
}

/** Browser-locale compact form (1.2万 / 1.2M) for the pill, full form for the tooltip. */
function formatCompact(total: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(total)
}
function formatFull(total: number): string {
  return new Intl.NumberFormat(undefined).format(total)
}

/**
 * Mobile-only drawer footer actions, relocated from the session header to the
 * drawer footer (beside Settings):
 * - Total tokens (leftmost): lifetime consumption across ALL sessions of the
 *   corpus, folded by the host half's `/api/mobile-nav.tokens.total` endpoint.
 *   Refreshes on tap. Loads only while the mobile query matches, so desktop
 *   never pays the corpus scan.
 * - Files: opens the dsh-web-ui aionui explorer as a floating bottom sheet
 *   (the explorer column is hidden on mobile until this marker is set, so
 *   the suite's own persisted-expanded state can never cover the UI on load).
 * - Session log: the official session-log-export controller, so the
 *   progress/result dialog is shared with the desktop flow.
 * Hidden entirely on wide screens (CSS media query).
 */
export function MobileDrawerFooter({ useSessions, downloadSessionLog, toggleSidebar, t }: MobileDrawerFooterProps) {
  const sessionId = useSessions((state) => state.current)
  const [tokens, setTokens] = useState<TokensState>({ status: 'loading' })

  const refreshTokens = useCallback((): void => {
    fetch('/api/mobile-nav.tokens.total')
      .then((res) => {
        if (!res.ok) throw new Error(`status ${res.status}`)
        return res.json() as Promise<TokensTotalBody>
      })
      .then((body) => {
        setTokens(
          body.ok && typeof body.totalTokens === 'number'
            ? { status: 'loaded', total: body.totalTokens }
            : { status: 'failed' },
        )
      })
      .catch(() => setTokens({ status: 'failed' }))
  }, [])

  useEffect(() => {
    const query = matchMedia(MOBILE_QUERY)
    const sync = (): void => {
      if (query.matches) refreshTokens()
    }
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [refreshTokens])

  const openExplorer = (): void => {
    // Yield the preview sheet first (compat.css gives preview precedence
    // over explorer), then open the explorer and close the drawer.
    getFrame()?.removeAttribute('data-aionui-preview-open')
    getFrame()?.setAttribute('data-aionui-explorer-open', '')
    toggleSidebar()
  }

  const tokensDisplay = tokens.status === 'loaded'
    ? formatCompact(tokens.total)
    : tokens.status === 'failed' ? '—' : '…'
  const tokensTitle = tokens.status === 'loaded'
    ? `${t('tokensTotal')} ${formatFull(tokens.total)}`
    : t('tokensTotal')

  return (
    <div data-mobile-nav="drawer-actions">
      <button
        type="button"
        data-mobile-nav="tokens-total"
        aria-label={tokensTitle}
        title={tokensTitle}
        onClick={refreshTokens}
      >
        <IconSparkle16 size={14} />
        <span>{t('tokensTotal')}</span>
        <span>{tokensDisplay}</span>
      </button>
      <button
        type="button"
        data-mobile-nav="explorer"
        aria-label={t('files')}
        title={t('files')}
        onClick={openExplorer}
      >
        <IconPanelLeftOutline16 size={14} />
        <span>{t('files')}</span>
      </button>
      <button
        type="button"
        data-mobile-nav="session-log"
        aria-label={t('sessionLog')}
        title={t('sessionLog')}
        disabled={sessionId === undefined}
        onClick={() => {
          if (sessionId !== undefined) downloadSessionLog(sessionId)
        }}
      >
        <IconDownloadOutline16 size={14} />
        <span>{t('sessionLog')}</span>
      </button>
    </div>
  )
}
