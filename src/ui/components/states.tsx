// Loading, empty and error states, plus an error boundary so one broken panel never blanks the app.

import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Component, type ReactNode } from 'react'
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
