// Hook for exporting optimization results as CSV

import { useState } from 'react'

export function useOptimizationExport() {
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const exportCSV = async (jobId: number) => {
    try {
      setExporting(true)
      setError(null)

      const response = await fetch(`/api/optimization/${jobId}/csv`)
      if (!response.ok) {
        throw new Error('Failed to export CSV')
      }

      // Get the blob and trigger download
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `optimization_results_job_${jobId}_${new Date().toISOString().split('T')[0]}.csv`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      console.error('Export error:', err)
    } finally {
      setExporting(false)
    }
  }

  return {
    exportCSV,
    exporting,
    error,
  }
}
