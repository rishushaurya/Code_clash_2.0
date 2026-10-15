// Loading, empty and error states, plus an error boundary so one broken panel never blanks the app.

import { AlertTriangle, Compass, RotateCcw, ServerCog } from 'lucide-react'
import { Component, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, children }: { icon: typeof AlertTriangle; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
      <Icon className="size-8" aria-hidden />
      <p className="font-medium text-foreground">{title}</p>
      {children}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-8 text-center">
      <AlertTriangle className="size-8 text-waste" aria-hidden />
      <p className="max-w-md text-sm">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCcw aria-hidden /> Try again
        </Button>
      )}
    </div>
  )
}

/** Title, one line on what the page is for, and its main actions */
export function PageHeader({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h1 className="font-heading text-2xl font-semibold md:text-3xl">{title}</h1>
        {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  )
}

/** A route this deployment does not have yet (another part of the app is still being built), or one that needs an online workspace */
export function NotYet({ what, reason = 'server', children }: { what: string; reason?: 'server' | 'local'; children?: ReactNode }) {
  return (
    <EmptyState icon={ServerCog} title={reason === 'local' ? `${what} needs an online workspace` : `${what} comes with the server update`}>
      <p className="max-w-md text-sm">
        {reason === 'local'
          ? 'This workspace lives in this browser only. Open an online workspace (the deployment needs Supabase) to use it.'
          : 'This server does not offer it yet. Nothing is lost: it appears here as soon as the server is updated.'}
      </p>
      {children}
    </EmptyState>
  )
}

export function NotFound() {
  return (
    <EmptyState icon={Compass} title="There is no page here">
      <p className="text-sm">The link may be old. Search with Ctrl+K, or go back to the overview.</p>
      <Button asChild variant="outline" size="sm" className="mt-2">
        <Link to="/">Open the overview</Link>
      </Button>
    </EmptyState>
  )
}

export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    console.error(JSON.stringify({ level: 'error', where: this.props.label ?? 'ui', message: error.message, stack: error.stack }))
  }
  render() {
    if (!this.state.error) return this.props.children
    return <ErrorState message={`Something went wrong in ${this.props.label ?? 'this section'}.`} onRetry={() => this.setState({ error: null })} />
  }
}
