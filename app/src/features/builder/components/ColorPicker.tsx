// src/features/builder/components/ColorPicker.tsx
// Color palette picker for node backgrounds

import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'

// Default pastel color palette
const DEFAULT_PALETTE = [
  '#F8E1E7', // Pink
  '#E5F2FF', // Light blue
  '#E3F6F5', // Mint
  '#FFF4D9', // Light yellow
  '#EDE7FF', // Lavender
  '#E1F0DA', // Light green
  '#F9EBD7', // Peach
  '#E7F7FF', // Sky blue
  '#F3E8FF', // Light purple
  '#EAF3FF', // Pale blue
]

export interface ColorPickerProps {
  /** Current color value */
  value?: string
  /** Called when a color is selected. Null clears the color. */
  onChange: (color: string | null) => void
  /** Custom color palette (optional) */
  palette?: string[]
}

export const ColorPicker = ({ value, onChange, palette = DEFAULT_PALETTE }: ColorPickerProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const colors = useMemo(() => palette, [palette])

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return
    const close = () => setIsOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [isOpen])

  return (
    <div className="relative inline-block">
      <Button
        variant={value ? 'accent' : 'ghost'}
        size="sm"
        onClick={(e) => {
          e.stopPropagation()
          setIsOpen((v) => !v)
        }}
        title={value ? 'Change color (color is set)' : 'Set color'}
      >
        ◐
      </Button>

      {isOpen && (
        <div
          className="absolute top-full mt-1 left-0 flex gap-1 p-2 bg-surface border border-border rounded-lg shadow-lg z-[200]"
          onClick={(e) => e.stopPropagation()}
        >
          {colors.map((c) => (
            <button
              key={c}
              className="w-6 h-6 rounded border border-border hover:scale-110 transition-transform"
              style={{ background: c }}
              onClick={() => {
                onChange(c)
                setIsOpen(false)
              }}
              title={c}
            />
          ))}
          {/* Clear color button */}
          <button
            className="w-6 h-6 rounded border border-border flex items-center justify-center text-xs hover:bg-muted"
            onClick={() => {
              onChange(null)
              setIsOpen(false)
            }}
            title="Clear color"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
