// Shards Combined Preview - Right card for generating and previewing the combined system

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { NodeCard } from '@/features/builder'
import type { FlowNode } from '@/types/flowNode'

interface ShardsCombinedPreviewProps {
  combinedTree: FlowNode | null
  filteredBranchesCount: number
  onGenerate: () => void
  onSaveToModel: () => Promise<void>
}

export function ShardsCombinedPreview({
  combinedTree,
  filteredBranchesCount,
  onGenerate,
  onSaveToModel
}: ShardsCombinedPreviewProps) {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      await onSaveToModel()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 bg-muted/30 rounded-lg flex flex-col h-full">
      <div className="text-sm font-medium mb-3">Combined System Preview</div>

      <div className="space-y-2 mb-3">
        <Button
          onClick={onGenerate}
          size="sm"
          disabled={filteredBranchesCount === 0}
          className="w-full"
        >
          Generate Combined Tree ({filteredBranchesCount} branches)
        </Button>

        {combinedTree && (
          <Button
            onClick={handleSave}
            size="sm"
            variant="accent"
            disabled={saving}
            className="w-full"
          >
            {saving ? 'Saving...' : 'Save to Model Tab'}
          </Button>
        )}

        {saveError && (
          <div className="text-xs text-red-500 p-2 bg-red-50 rounded">
            {saveError}
          </div>
        )}
      </div>

      {/* Flowchart Preview */}
      <div className="flex-1 overflow-auto border rounded p-2 bg-background">
        {combinedTree ? (
          <NodeCard
            node={combinedTree}
            depth={0}
            onReplace={() => {}}  // Read-only
            onDelete={() => {}}   // Read-only
            onUpdate={() => {}}   // Read-only
          />
        ) : (
          <div className="text-sm text-muted-foreground text-center py-8">
            Load a job, apply filters, and click "Generate Combined Tree" to preview the combined system
          </div>
        )}
      </div>
    </div>
  )
}
