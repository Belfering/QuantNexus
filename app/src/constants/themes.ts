// src/constants/themes.ts
// Color theme configuration

import type { ColorTheme } from '../types'

export const COLOR_THEMES: { id: ColorTheme; name: string; accent: string }[] = [
  { id: 'slate', name: 'Slate', accent: '#3b82f6' },
  { id: 'ocean', name: 'Ocean', accent: '#0ea5e9' },
  { id: 'emerald', name: 'Emerald', accent: '#10b981' },
  { id: 'violet', name: 'Violet', accent: '#8b5cf6' },
  { id: 'rose', name: 'Rose', accent: '#f43f5e' },
  { id: 'amber', name: 'Amber', accent: '#f59e0b' },
  { id: 'cyan', name: 'Cyan', accent: '#06b6d4' },
  { id: 'indigo', name: 'Indigo', accent: '#6366f1' },
  { id: 'lime', name: 'Lime', accent: '#84cc16' },
  { id: 'fuchsia', name: 'Fuchsia', accent: '#d946ef' },
]
