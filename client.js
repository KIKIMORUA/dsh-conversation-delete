/**
 * Client half of `dsh-conversation-delete`.
 *
 * Registers one row in the Session row's "..." menu
 * (`sidebar.workspaces.session.menu.item`) that deletes the conversation
 * through the Host route in `index.js`. The row confirms in place on a second
 * click, so it never opens a native dialog or a second surface.
 */
window.__ModuleLoader__.load({
  id: 'dsh-conversation-delete',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const ENDPOINT = '/plugin-conversation-delete/delete'
    const REQUEST_HEADER = 'x-dsh-conversation-delete'

    const COPY = {
      zh: {
        menu: '删除对话',
        confirm: '确认删除？不可恢复',
        busy: '正在删除…',
        failed: '删除失败：',
        untitled: '未命名对话',
        running: '这个对话还在运行，请等本轮结束或先停止。',
        logBusy: '会话日志仍被占用，请关闭该对话后重试。',
        badId: '对话标识无效。',
        forbidden: '请求被拒绝。',
      },
      en: {
        menu: 'Delete chat',
        confirm: 'Delete? This cannot be undone',
        busy: 'Deleting…',
        failed: 'Delete failed: ',
        untitled: 'Untitled chat',
        running: 'This chat is still running. Finish or stop the current turn first.',
        logBusy: 'The session log is still in use. Close the chat and retry.',
        badId: 'Not a valid conversation id.',
        forbidden: 'The request was refused.',
      },
    }

    /** Localized text for one Host failure code. */
    function describe(copy, code, fallback) {
      switch (code) {
        case 'session/running': return copy.running
        case 'session/log-busy': return copy.logBusy
        case 'invalid-session-id': return copy.badId
        case 'forbidden': return copy.forbidden
        default: return fallback
      }
    }

    /** The active locale id, read from the Client locale service when present. */
    function localeId(ctx) {
      try {
        const locale = typeof ctx.get === 'function' ? ctx.get('locale') : ctx.locale
        const snapshot = locale && typeof locale.getLocale === 'function' ? locale.getLocale() : undefined
        const id = snapshot && (snapshot.locale || snapshot.id || snapshot.active)
        if (typeof id === 'string' && id.length > 0) return id
      } catch {
        // Fall through to the browser preference.
      }
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') return navigator.language
      } catch {
        // Ignore an unavailable navigator.
      }
      return 'en'
    }

    /** Copy for the current locale. */
    function copyFor(ctx) {
      return localeId(ctx).toLowerCase().startsWith('zh') ? COPY.zh : COPY.en
    }

    /** Truncate one label so a long failure cannot stretch the menu. */
    function clip(text, limit) {
      const value = String(text === undefined || text === null ? '' : text)
      return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
    }

    /** Inline styles built from Host theme tokens. */
    function buttonStyle({ danger, hover, disabled }) {
      return {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        boxSizing: 'border-box',
        width: '100%',
        minHeight: '28px',
        margin: 0,
        padding: '4px 8px',
        border: 0,
        borderRadius: 'var(--dsw-radius-md, 8px)',
        background: hover && !disabled
          ? 'var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2))'
          : 'transparent',
        color: danger ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        fontSize: '13px',
        lineHeight: '20px',
        textAlign: 'left',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }
    }

    /** The trash glyph, tinted by the row's current color. */
    function trashIcon() {
      return h(
        'svg',
        {
          width: 14,
          height: 14,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { flex: 'none' },
        },
        h('path', { d: 'M2.5 4.2h11' }),
        h('path', { d: 'M6.1 4.2V2.6h3.8v1.6' }),
        h('path', { d: 'M3.7 4.2l.7 8.9a1 1 0 0 0 1 .9h5.2a1 1 0 0 0 1-.9l.7-8.9' }),
        h('path', { d: 'M6.6 6.9v4.6M9.4 6.9v4.6' }),
      )
    }

    /**
     * One menu row: first click arms, second click deletes.
     * @param props - row identity, the menu open-state hook, and the injected operation.
     */
    function DeleteSessionMenuItem({ sessionId, displayTitle, useMenuOpenState, remove, copy }) {
      const [, setMenuOpen] = useMenuOpenState()
      const [phase, setPhase] = React.useState('idle')
      const [hover, setHover] = React.useState(false)
      const [failure, setFailure] = React.useState('')

      React.useEffect(() => {
        if (phase !== 'confirm' && phase !== 'error') return undefined
        const timer = setTimeout(() => setPhase('idle'), 6000)
        return () => clearTimeout(timer)
      }, [phase])

      const title = displayTitle && displayTitle.trim().length > 0 ? displayTitle : copy.untitled
      const armed = phase === 'confirm'
      const busy = phase === 'busy'

      let label = copy.menu
      if (armed) label = copy.confirm
      else if (busy) label = copy.busy
      else if (phase === 'error') label = `${copy.failed}${clip(failure, 42)}`

      const onClick = () => {
        if (busy) return
        if (!armed) {
          setFailure('')
          setPhase('confirm')
          return
        }
        setPhase('busy')
        Promise.resolve()
          .then(() => remove(sessionId))
          .then(() => {
            setMenuOpen(false)
          })
          .catch((error) => {
            setFailure(error && error.message ? error.message : String(error))
            setPhase('error')
          })
      }

      return h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          disabled: busy,
          title: `${copy.menu}: ${title}`,
          'aria-label': `${copy.menu}: ${title}`,
          onClick,
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          style: buttonStyle({ danger: armed || phase === 'error', hover, disabled: busy }),
        },
        trashIcon(),
        h(
          'span',
          { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          label,
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        /** Run the Host deletion and leave the open conversation if it was this one. */
        async function remove(sessionId) {
          const response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              [REQUEST_HEADER]: '1',
            },
            body: JSON.stringify({ sessionId }),
          })
          const payload = await response.json().catch(() => null)
          if (!response.ok || payload === null || payload.ok !== true) {
            const code = payload !== null && typeof payload.code === 'string' ? payload.code : ''
            const reason = payload !== null && typeof payload.message === 'string' && payload.message.length > 0
              ? payload.message
              : `HTTP ${response.status}`
            throw new Error(describe(copyFor(ctx), code, reason))
          }
          try {
            const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : ctx.sessions
            const open = sessions && typeof sessions.binding === 'function'
              ? sessions.binding(sessionId)
              : undefined
            if (open !== undefined) {
              const layout = typeof ctx.get === 'function' ? ctx.get('layout') : ctx.layout
              if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(null)
            }
          } catch {
            // Navigation is a convenience; the Host already removed the row.
          }
          return payload
        }

        ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'dsh-conversation-delete',
          order: 500,
          inject: () => ({ remove, copy: copyFor(ctx) }),
        }, DeleteSessionMenuItem))
      },
    }
  },
})
