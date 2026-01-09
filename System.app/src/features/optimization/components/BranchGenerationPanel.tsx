// src/features/optimization/components/BranchGenerationPanel.tsx
// Branch generation progress and results panel

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { BranchGenerationJob } from '@/types/branch'
import { BranchResultsTable } from './BranchResultsTable'

interface BranchGenerationPanelProps {
  job: BranchGenerationJob | null
  onSelectBranch: (branchId: string) => void
  onCancel: () => void
}

export function BranchGenerationPanel({ job, onSelectBranch, onCancel }: BranchGenerationPanelProps) {
  if (!job || job.status === 'idle') {
    return null
  }

  const isRunning = job.status === 'running'
  const isComplete = job.status === 'complete'
  const isCancelled = job.status === 'cancelled'
  const isError = job.status === 'error'

  const percentage = job.progress.total > 0 ? Math.round((job.progress.completed / job.progress.total) * 100) : 0

  // Count results by status
  const passedCount = job.results.filter(r => r.passed).length
  const failedCount = job.results.filter(r => r.status === 'success' && !r.passed).length
  const errorCount = job.results.filter(r => r.status === 'error').length

  return (
    <Card className="p-6 mt-4">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">Branch Generation</h3>
          {isRunning && (
            <Button size="sm" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>

        {/* Running State */}
        {isRunning && (
          <>
            <div className="space-y-2">
              {/* Progress Bar */}
              <div className="w-full bg-muted rounded-full h-6 overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300 flex items-center justify-center text-xs font-medium text-primary-foreground"
                  style={{ width: `${percentage}%` }}
                >
                  {percentage}%
                </div>
              </div>

              {/* Progress Text */}
              <div className="text-sm text-center text-muted-foreground">
                Generating branches... {job.progress.completed} / {job.progress.total} completed
              </div>
            </div>
          </>
        )}

        {/* Completed State */}
        {isComplete && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="text-sm">
              <span className="font-medium">Results:</span>{' '}
              <span className="text-green-500">{passedCount} passed</span>,{' '}
              <span className="text-red-500">{failedCount} failed</span>
              {errorCount > 0 && (
                <>
                  , <span className="text-orange-500">{errorCount} errors</span>
                </>
              )}
            </div>

            {/* Results Table */}
            <BranchResultsTable results={job.results} onSelectBranch={onSelectBranch} />
          </div>
        )}

        {/* Cancelled State */}
        {isCancelled && (
          <div className="text-sm text-orange-500">
            Branch generation cancelled. {job.progress.completed} / {job.progress.total} branches completed.
          </div>
        )}

        {/* Error State */}
        {isError && (
          <div className="text-sm text-red-500">
            Error: {job.errorMessage || 'Unknown error occurred'}
          </div>
        )}
      </div>
    </Card>
  )
}
