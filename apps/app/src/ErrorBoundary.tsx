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
        <div className="view center" style={{ minHeight: '100vh' }}>
          <div>
            <h1>Something went wrong</h1>
            <p className="muted">{String(this.state.error)}</p>
            <button onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
