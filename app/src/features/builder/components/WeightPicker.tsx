// src/features/builder/components/WeightPicker.tsx
// Dropdown picker for weight modes

import { useState, useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { WeightMode } from '../../../types'

export const weightLabel = (mode: WeightMode): string => {
  switch (mode) {
    case 'equal':
      return 'Equal Weight'
    case 'defined':
      return 'Defined'
    case 'inverse':
      return 'Inverse Volatility'
    case 'pro':
      return 'Pro Volatility'
    case 'capped':
      return 'Capped'
  }
}

const WEIGHT_MODES: WeightMode[] = ['equal', 'defined', 'inverse', 'pro', 'capped']

export interface WeightPickerProps {
  value: WeightMode
  onChange: (mode: WeightMode) => void
  /** If true, keep dropdown open when selecting 'capped' (for additional config) */
  keepOpenOnCapped?: boolean
}

export const WeightPicker = ({ value, onChange, keepOpenOnCapped = true }: WeightPickerProps) => {
  const [isOpen, setIsOpen] = useState(false)

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return
    const close = () => setIsOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [isOpen])

  return (
    <div className="relative flex items-center gap-2">
      <Badge
        variant="default"
        className="cursor-pointer gap-1 py-1 px-2.5"
        onClick={(e) => {
          e.stopPropagation()
          setIsOpen((v) => !v)
        }}
      >
        {weightLabel(value)}
      </Badge>
      {isOpen && (
        <div
          className="absolute top-full mt-1 left-0 flex flex-col bg-surface border border-border rounded-lg shadow-lg z-[200] min-w-[120px]"
          onClick={(e) => e.stopPropagation()}
        >
          {WEIGHT_MODES.map((w) => (
            <Button
              key={w}
              variant="ghost"
              className="justify-start rounded-none first:rounded-t-lg last:rounded-b-lg"
              onClick={() => {
                onChange(w)
                if (!keepOpenOnCapped || w !== 'capped') {
                  setIsOpen(false)
                }
              }}
            >
              {weightLabel(w)}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
