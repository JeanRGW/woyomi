import { Component, type ErrorInfo, type ReactNode } from 'react'
import { I18nContext, type I18nContextValue } from './i18n'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Catches render errors so a crash shows a message + reload instead of a blank window. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static contextType = I18nContext
  declare context: I18nContextValue

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('render error:', error, info)
  }

  render(): ReactNode {
    const t = this.context.t
    if (this.state.error) {
      return (
        <div className="grid min-h-screen place-items-center bg-ink p-6 text-fg">
          <div className="max-w-md text-center">
            <h1 className="text-xl font-extrabold tracking-tight">{t('common.errorTitle')}</h1>
            <p className="mt-2 text-sm text-muted">{String(this.state.error)}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-5 min-h-10 cursor-pointer rounded-xl bg-accent px-5 text-sm font-semibold text-white hover:bg-accent-deep"
            >
              {t('common.reload')}
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
