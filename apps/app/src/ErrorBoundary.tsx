import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Catches render errors so a crash shows a message + reload instead of a blank window. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('render error:', error, info)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="grid min-h-screen place-items-center bg-ink p-6 text-fg">
          <div className="max-w-md text-center">
            <h1 className="text-xl font-extrabold tracking-tight">Something went wrong</h1>
            <p className="mt-2 text-sm text-muted">{String(this.state.error)}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-5 min-h-10 cursor-pointer rounded-xl bg-accent px-5 text-sm font-semibold text-white hover:bg-accent-deep"
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
