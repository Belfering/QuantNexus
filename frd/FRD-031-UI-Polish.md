# FRD-031: UI Polish

## Metadata
- **ID**: FRD-031
- **Title**: UI Polish
- **Status**: PROPOSED
- **Priority**: Medium (Enhancement)
- **Owner**: System
- **Created**: 2025-01-03
- **Last Updated**: 2025-01-03
- **Depends On**: FRD-030 (Scalable Architecture Overhaul)

---

## Executive Summary

This FRD covers UI/UX improvements to be implemented after the architecture restructure (FRD-030). These are polish items that enhance user experience but are not required for core functionality.

---

## Goals

1. Improve user feedback with toast notifications
2. Add power-user keyboard shortcuts
3. Optimize long lists with virtualization
4. Support viewing on mobile/tablet devices
5. Ensure accessibility standards
6. Add optional dark mode

## Non-Goals

1. Skeleton loaders (user preference)
2. Code splitting (not worth complexity for this app size)
3. Full mobile editing experience

---

## Implementation

### 1. Toast Notifications

**Library**: `sonner` (lightweight, modern)

```bash
npm install sonner
```

**Setup** (`src/main.tsx`):

```typescript
import { Toaster } from 'sonner'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <App />
    <Toaster position="bottom-right" richColors />
  </QueryClientProvider>
)
```

**Usage**:

```typescript
import { toast } from 'sonner'

// Success
toast.success('Bot saved successfully')

// Error
toast.error('Failed to run backtest')

// Loading
const id = toast.loading('Running backtest...')
// Later...
toast.success('Backtest complete', { id })

// With action
toast('Bot deleted', {
  action: {
    label: 'Undo',
    onClick: () => restoreBot(botId)
  }
})
```

**Where to add toasts**:
| Action | Toast Type | Message |
|--------|------------|---------|
| Save bot | Success | "Bot saved" |
| Delete bot | Success + Undo | "Bot deleted" |
| Run backtest | Loading → Success | "Running..." → "Complete" |
| Copy to clipboard | Success | "Copied!" |
| API error | Error | Error message |
| Publish to Nexus | Success | "Published to Nexus" |

---

### 2. Keyboard Shortcuts

**Library**: `react-hotkeys-hook`

```bash
npm install react-hotkeys-hook
```

**Setup** (`src/features/builder/hooks/useKeyboardShortcuts.ts`):

```typescript
import { useHotkeys } from 'react-hotkeys-hook'

export function useKeyboardShortcuts({
  onSave,
  onUndo,
  onRedo,
  onBacktest,
  onDelete,
}: ShortcutHandlers) {
  // Save
  useHotkeys('ctrl+s, cmd+s', (e) => {
    e.preventDefault()
    onSave()
  }, { enableOnFormTags: false })

  // Undo/Redo (already have history)
  useHotkeys('ctrl+z, cmd+z', onUndo)
  useHotkeys('ctrl+shift+z, cmd+shift+z', onRedo)

  // Run backtest
  useHotkeys('ctrl+b, cmd+b', (e) => {
    e.preventDefault()
    onBacktest()
  })

  // Delete selected
  useHotkeys('delete, backspace', onDelete, { enableOnFormTags: false })

  // Escape to close modals
  useHotkeys('escape', onCloseModal)
}
```

**Keyboard shortcuts to implement**:

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + S` | Save current bot |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` | Redo |
| `Ctrl/Cmd + B` | Run backtest |
| `Delete` | Delete selected node |
| `Escape` | Close modal/menu |
| `Ctrl/Cmd + C` | Copy selected node |
| `Ctrl/Cmd + V` | Paste node |

**Show shortcuts in UI**:
Add a help tooltip or modal showing available shortcuts.

---

### 3. Virtualization

**Library**: `@tanstack/react-virtual`

```bash
npm install @tanstack/react-virtual
```

**Where needed**:
- Nexus leaderboard (500+ bots)
- Watchlist with many bots
- Long dropdown lists (tickers)

**Example** (`src/features/nexus/components/NexusList.tsx`):

```typescript
import { useVirtualizer } from '@tanstack/react-virtual'

function NexusList({ bots }: { bots: Bot[] }) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: bots.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80, // Estimated row height
    overscan: 5, // Render 5 extra rows for smooth scrolling
  })

  return (
    <div ref={parentRef} style={{ height: '600px', overflow: 'auto' }}>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <BotCard bot={bots[virtualRow.index]} />
          </div>
        ))}
      </div>
    </div>
  )
}
```

**Performance impact**:
- Without virtualization: 500 bots = 500 DOM nodes = slow
- With virtualization: 500 bots = ~15 visible DOM nodes = fast

---

### 4. Responsive Design

**Approach**: View-only on smaller screens, full editing on desktop.

**Breakpoints**:

```css
/* src/styles/globals.css */
:root {
  --breakpoint-sm: 640px;
  --breakpoint-md: 768px;
  --breakpoint-lg: 1024px;
  --breakpoint-xl: 1280px;
}
```

**Behavior by screen size**:

| Screen | Width | Behavior |
|--------|-------|----------|
| Mobile | <640px | Equity chart, metrics only. No tree editing. |
| Tablet | 640-1024px | View bot details, simplified tree view. |
| Desktop | >1024px | Full builder experience |

**Implementation**:

```typescript
// src/shared/hooks/useBreakpoint.ts
export function useBreakpoint() {
  const [width, setWidth] = useState(window.innerWidth)

  useEffect(() => {
    const handleResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return {
    isMobile: width < 640,
    isTablet: width >= 640 && width < 1024,
    isDesktop: width >= 1024,
  }
}
```

**Usage**:

```typescript
function App() {
  const { isMobile, isDesktop } = useBreakpoint()

  if (isMobile) {
    return <MobileView />  // Just charts and metrics
  }

  return <FullBuilder />
}
```

---

### 5. Accessibility (a11y)

**Focus Management**:

```typescript
// When modal opens, focus first input
useEffect(() => {
  if (isOpen) {
    firstInputRef.current?.focus()
  }
}, [isOpen])

// Trap focus inside modal
import { useFocusTrap } from '@mantine/hooks'
// or implement manually
```

**ARIA Labels**:

```typescript
// Bad
<button onClick={onDelete}>X</button>

// Good
<button
  onClick={onDelete}
  aria-label="Delete node"
  title="Delete node"
>
  X
</button>
```

**Keyboard Navigation**:

```typescript
// Make tree nodes keyboard navigable
<div
  role="treeitem"
  tabIndex={0}
  aria-selected={isSelected}
  onKeyDown={(e) => {
    if (e.key === 'Enter') onSelect()
    if (e.key === 'ArrowDown') onNext()
    if (e.key === 'ArrowUp') onPrev()
  }}
>
  {node.title}
</div>
```

**Color Contrast**:
- Ensure text has 4.5:1 contrast ratio against background
- Don't rely on color alone to convey information
- Test with browser accessibility tools

**Checklist**:
- [ ] All interactive elements have focus styles
- [ ] Modals trap focus and return focus on close
- [ ] Images have alt text
- [ ] Form inputs have labels
- [ ] Color contrast meets WCAG AA
- [ ] Screen reader testing

---

### 6. Dark Mode (Optional)

**Approach**: CSS variables with class toggle.

**CSS** (`src/styles/globals.css`):

```css
:root {
  /* Light mode (default) */
  --bg-primary: #ffffff;
  --bg-secondary: #f5f5f5;
  --text-primary: #1a1a1a;
  --text-secondary: #666666;
  --border: #e5e5e5;
  --accent: #3b82f6;
}

.dark {
  --bg-primary: #1a1a1a;
  --bg-secondary: #2d2d2d;
  --text-primary: #ffffff;
  --text-secondary: #a0a0a0;
  --border: #404040;
  --accent: #60a5fa;
}

body {
  background: var(--bg-primary);
  color: var(--text-primary);
}
```

**Toggle hook**:

```typescript
// src/shared/hooks/useDarkMode.ts
export function useDarkMode() {
  const [isDark, setIsDark] = useLocalStorage('darkMode', false)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  return { isDark, toggle: () => setIsDark(!isDark) }
}
```

**UI Toggle**:

```typescript
function ThemeToggle() {
  const { isDark, toggle } = useDarkMode()

  return (
    <button onClick={toggle} aria-label="Toggle dark mode">
      {isDark ? <Sun /> : <Moon />}
    </button>
  )
}
```

---

## Dependencies

```bash
npm install sonner              # Toast notifications
npm install react-hotkeys-hook  # Keyboard shortcuts
npm install @tanstack/react-virtual  # List virtualization
npm install lucide-react        # Icons (Sun, Moon, etc.)
```

---

## Priority Order

| Priority | Feature | Effort | Impact |
|----------|---------|--------|--------|
| 1 | Toast notifications | Low | High - immediate user feedback |
| 2 | Virtualization | Medium | High - required for Nexus scale |
| 3 | Keyboard shortcuts | Low | Medium - power user delight |
| 4 | Responsive design | Medium | Medium - broader device support |
| 5 | Accessibility | Medium | Medium - professional polish |
| 6 | Dark mode | Low | Low - nice to have |

---

## Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `src/shared/hooks/useKeyboardShortcuts.ts` | Keyboard shortcut bindings |
| `src/shared/hooks/useBreakpoint.ts` | Responsive breakpoint detection |
| `src/shared/hooks/useDarkMode.ts` | Dark mode toggle |
| `src/features/nexus/components/VirtualizedList.tsx` | Virtualized bot list |

### Files to Modify

| File | Changes |
|------|---------|
| `src/main.tsx` | Add Toaster component |
| `src/styles/globals.css` | Add CSS variables, dark mode |
| `src/App.tsx` | Add keyboard shortcuts, breakpoint logic |
| `src/features/nexus/components/NexusList.tsx` | Add virtualization |

---

## Acceptance Criteria

- [ ] Toast notifications appear for all user actions
- [ ] Keyboard shortcuts work (Ctrl+S, Ctrl+Z, etc.)
- [ ] Nexus list performs smoothly with 500+ bots
- [ ] App is viewable (not editable) on mobile
- [ ] All interactive elements have focus styles
- [ ] ARIA labels on buttons without text
- [ ] Dark mode toggle works (if implemented)

---

## Open Questions

1. Should dark mode respect system preference (`prefers-color-scheme`)?
2. Should we add a shortcuts help modal (`?` key)?
3. Do we need haptic feedback on mobile for actions?
