import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Icon, type IconName } from './icons'

export interface ToastOptions {
  action?: {
    label: string
    onClick: () => void
  }
  icon?: IconName
  tone?: 'default' | 'ok' | 'error'
  duration?: number
}

export interface ToastItem extends ToastOptions {
  id: string
  message: string
}

interface ToastContextValue {
  showToast: (message: string, options?: ToastOptions) => void
  dismissToast: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return ctx
}

let toastIdCounter = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const showToast = useCallback(
    (message: string, options?: ToastOptions) => {
      const id = String(++toastIdCounter)
      const item: ToastItem = {
        id,
        message,
        duration: options?.duration ?? 3500,
        ...options
      }
      setToasts((prev) => [...prev.slice(-2), item]) // keep max 3 visible
    },
    []
  )

  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  )
}

function ToastContainer({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null

  return (
    <aside
      aria-label="Notifications"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-16 z-50 flex flex-col items-center gap-2 p-4 md:bottom-6 md:right-6 md:left-auto md:items-end"
      style={{ bottom: 'calc(var(--sab) + 4.5rem)' }}
    >
      {toasts.map((item) => (
        <ToastCard key={item.id} item={item} onDismiss={() => onDismiss(item.id)} />
      ))}
    </aside>
  )
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    if (!item.duration || item.duration <= 0) return
    const timer = window.setTimeout(onDismiss, item.duration)
    return () => window.clearTimeout(timer)
  }, [item.duration, onDismiss])

  const iconName = item.icon ?? (item.tone === 'ok' ? 'check' : item.tone === 'error' ? 'refresh' : undefined)

  return (
    <div
      role="status"
      className="rise-in pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl border border-line bg-surface-2/95 px-4 py-3 shadow-2xl shadow-black/60 backdrop-blur-xl transition-all"
    >
      {iconName && (
        <div
          className={`grid size-7 shrink-0 place-items-center rounded-xl ${
            item.tone === 'ok'
              ? 'bg-ok-soft text-ok'
              : item.tone === 'error'
                ? 'bg-danger-soft text-danger'
                : 'bg-accent-soft text-accent'
          }`}
        >
          <Icon name={iconName} size={15} />
        </div>
      )}
      <p className="min-w-0 flex-1 text-sm font-semibold text-fg">{item.message}</p>
      {item.action && (
        <button
          type="button"
          onClick={() => {
            item.action?.onClick()
            onDismiss()
          }}
          className="shrink-0 cursor-pointer rounded-lg bg-accent px-2.5 py-1 text-xs font-bold text-white transition-colors hover:bg-accent-deep"
        >
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-full text-muted hover:bg-surface-3 hover:text-fg"
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  )
}
