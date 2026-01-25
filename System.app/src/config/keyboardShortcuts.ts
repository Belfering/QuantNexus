// Centralized keyboard shortcut definitions
// Used in tooltips to show users available shortcuts

export interface KeyboardShortcut {
  keys: string
  action: string
  context: string
}

export const KEYBOARD_SHORTCUTS = {
  // Global shortcuts (work anywhere in the app)
  global: [
    { keys: 'Ctrl+Z', action: 'Undo last change', context: 'Global' },
    { keys: 'Ctrl+Y', action: 'Redo last undone change', context: 'Global' },
    { keys: 'Ctrl+S', action: 'Save current strategy', context: 'Global' },
  ] as KeyboardShortcut[],

  // Model tab shortcuts
  model: [
    { keys: 'Delete', action: 'Delete selected node', context: 'Node card' },
    { keys: 'Ctrl+C', action: 'Copy node and subtree', context: 'Node card' },
    { keys: 'Ctrl+V', action: 'Paste copied node', context: 'Node card' },
    { keys: 'Ctrl+D', action: 'Duplicate node', context: 'Node card' },
    { keys: 'Ctrl+Z', action: 'Undo tree change', context: 'Model' },
    { keys: 'Ctrl+Y', action: 'Redo tree change', context: 'Model' },
  ] as KeyboardShortcut[],

  // Backtest panel shortcuts
  backtest: [
    { keys: 'Ctrl+Enter', action: 'Run backtest', context: 'Backtest panel' },
    { keys: 'Ctrl+B', action: 'Toggle benchmark comparison', context: 'Backtest panel' },
    { keys: 'Tab', action: 'Switch between analysis tabs', context: 'Backtest results' },
  ] as KeyboardShortcut[],

  // Forge tab shortcuts
  forge: [
    { keys: 'Ctrl+R', action: 'Run optimization', context: 'Forge tab' },
    { keys: 'Ctrl+F', action: 'Apply filter', context: 'Shards filter' },
    { keys: 'Ctrl+L', action: 'Load optimization results', context: 'Forge tab' },
  ] as KeyboardShortcut[],

  // Analyze tab shortcuts
  analyze: [
    { keys: 'Ctrl+W', action: 'Run walk-forward analysis', context: 'Analyze tab' },
    { keys: 'Ctrl+E', action: 'Export analysis results', context: 'Analyze tab' },
  ] as KeyboardShortcut[],

  // Dashboard shortcuts
  dashboard: [
    { keys: 'Ctrl+N', action: 'Create new bot', context: 'Dashboard' },
    { keys: 'Ctrl+O', action: 'Open saved strategy', context: 'Dashboard' },
    { keys: 'Ctrl+I', action: 'Import strategy', context: 'Dashboard' },
  ] as KeyboardShortcut[],

  // Admin tab shortcuts
  admin: [
    { keys: 'Ctrl+T', action: 'Add new ticker', context: 'Admin tab' },
    { keys: 'Ctrl+D', action: 'Download ticker data', context: 'Admin tab' },
  ] as KeyboardShortcut[],

  // Nexus tab shortcuts
  nexus: [
    { keys: 'Ctrl+P', action: 'Pause/Resume bot', context: 'Nexus tab' },
    { keys: 'Ctrl+K', action: 'Stop bot', context: 'Nexus tab' },
  ] as KeyboardShortcut[],
}

// Helper function to get shortcut by action
export function getShortcutForAction(action: string): string | undefined {
  for (const category of Object.values(KEYBOARD_SHORTCUTS)) {
    const shortcut = category.find(s => s.action === action)
    if (shortcut) return shortcut.keys
  }
  return undefined
}

// Helper function to format shortcut for display
export function formatShortcut(keys: string): string {
  return keys.replace('Ctrl', '⌘').replace('+', ' + ')
}
