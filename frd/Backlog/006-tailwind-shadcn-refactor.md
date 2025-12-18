# PRD: Full UI Refactor with Tailwind CSS + shadcn/ui

## Metadata
- ID: 006
- Title: Full UI Refactor with Tailwind CSS + shadcn/ui
- Status: draft
- Owner:
- Depends on: None
- Supersedes: None
- Created: 2025-12-17
- Last updated: 2025-12-17

## Summary

**Full refactor** of the System Block Chain application's entire UI layer to use Tailwind CSS and shadcn/ui. This is a complete replacement of the current custom CSS system (~1,250 lines in App.css) and all inline styles in App.tsx (~8,000+ lines). The goal is to eliminate App.css entirely and convert all styling to Tailwind utilities and shadcn/ui components.

## Goals

1. **Complete CSS Elimination**: Remove App.css entirely - all styles via Tailwind utilities
2. **Full Component Replacement**: Every UI element uses shadcn/ui or Tailwind classes
3. **Consistent Design System**: Unified look and feel across all views (Build, Analyze, Portfolio)
4. **Native Dark Mode**: Tailwind's `dark:` variant for all components
5. **Zero Inline Style Objects**: Replace all React `style={{}}` props with Tailwind classes
6. **Improved Maintainability**: Single source of truth for design tokens in tailwind.config.js

## Non-goals

- Adding new features during refactor
- Changing component architecture or state management
- Backend changes

## User Stories

1. As a developer, I want to use utility classes so I can style components without switching files
2. As a developer, I want consistent button/input/card components so the UI feels cohesive
3. As a user, I want dark mode to work reliably across all components

## UX / UI

### Components to Replace with shadcn/ui

| Current | shadcn/ui Replacement |
|---------|----------------------|
| Custom buttons | `Button` component |
| `<select>` elements | `Select` component |
| `<input>` elements | `Input` component |
| `.node-card` | `Card` component |
| `.stat-card` | `Card` component |
| `.menu` dropdowns | `DropdownMenu` component |
| `.backtester-table` | `Table` component |
| `.monthly-table` | `Table` component |
| Tabs (`.tab-btn`) | `Tabs` component |
| Color picker | `Popover` + custom swatches |

### Tailwind Classes for Custom Styles

These will remain as Tailwind utility compositions:
- Chart containers and wrappers
- Grid layouts (`.backtester-grid2`, `.panel-grid`)
- Navigator overlay/window styles
- Condition bubbles and chips

### Dark Mode Strategy

- Use Tailwind's `dark:` variant with class-based toggling
- Add `dark` class to root element based on theme state
- Configure shadcn/ui to use CSS variables that respect dark mode

## Data Model / State

No changes to data model. Theme state already exists in App.tsx.

## Behavioral Spec

### Happy Paths
1. Install Tailwind + dependencies → Configure → Incrementally migrate components
2. All existing functionality preserved during migration
3. Dark/light mode toggle continues to work

### Edge Cases
- Charts (lightweight-charts) may need wrapper adjustments for Tailwind
- ReactFlow nodes may need custom styling approach

### Errors / Validation
- Build should pass with no TypeScript errors
- No visual regressions (manual testing required)

## Acceptance Criteria

- [ ] Tailwind CSS installed and configured
- [ ] shadcn/ui installed with all required components
- [ ] **App.css deleted** - zero custom CSS remaining
- [ ] **All inline `style={{}}` removed** from App.tsx
- [ ] All buttons use shadcn Button component
- [ ] All inputs use shadcn Input component
- [ ] All selects use shadcn Select component
- [ ] All cards use shadcn Card component
- [ ] All tables use shadcn Table component
- [ ] All tabs use shadcn Tabs component
- [ ] All dropdowns use shadcn DropdownMenu component
- [ ] Dark mode works via Tailwind `dark:` classes on all elements
- [ ] Build passes (`npm run build`)
- [ ] Lint passes (`npm run lint`)

## Scope of Changes

### Files to Modify
- `System.app/src/App.tsx` - Replace all `style={{}}` with `className="..."` Tailwind classes
- `System.app/src/main.tsx` - Import Tailwind base styles
- `System.app/src/index.css` - Tailwind directives only
- `System.app/tailwind.config.js` - New file with design tokens
- `System.app/postcss.config.js` - New file
- `System.app/components.json` - shadcn/ui config
- `System.app/src/components/ui/*` - shadcn/ui components
- `System.app/src/lib/utils.ts` - cn() utility for class merging

### Files to Delete
- `System.app/src/App.css` - Entire file removed

### Estimated Scale
- **125 CSS classes** in App.css to convert
- **286 inline `style={{}}` objects** in App.tsx to convert
- **368 `className=` usages** to update
- ~15 shadcn/ui components to install

## Complete List of Areas to Update

### 1. App Shell & Layout (6 classes)
| CSS Class | Description | Convert To |
|-----------|-------------|------------|
| `.app` | Root container with CSS variables | Tailwind config + dark mode |
| `.app.theme-dark` | Dark mode variables | Tailwind `dark:` variants |
| `.app-header` | Sticky header bar | Tailwind flex + sticky |
| `.api-warning` | API error banner | shadcn Alert |
| `.header-actions` | Header button group | Tailwind flex |
| `.canvas` | Main content wrapper | Tailwind padding |

### 2. Tabs & Navigation (9 classes)
| CSS Class | Description | Convert To |
|-----------|-------------|------------|
| `.tabs` | Tab container | shadcn Tabs |
| `.tab-btn` | Tab button | shadcn TabsTrigger |
| `.bot-tabs` | Bot tab container | shadcn Tabs |
| `.bot-tab-wrapper` | Bot tab item wrapper | Tailwind flex |
| `.bot-tab-btn` | Bot tab button | shadcn TabsTrigger |
| `.bot-tab-close` | Bot tab close button | shadcn Button variant |
| `.build-actions` | Build tab action buttons | Tailwind flex |
| `.link-btn` | Text link button | shadcn Button variant="link" |

### 3. Node/Flowchart Builder (22 classes)
| CSS Class | Description | Convert To |
|-----------|-------------|------------|
| `.node-card` | Main node container | shadcn Card |
| `.node-head` | Node header row | Tailwind flex |
| `.node-title` | Node title text | Tailwind typography |
| `.title-input` | Title edit input | shadcn Input |
| `.head-actions` | Node action buttons | Tailwind flex |
| `.icon-btn` | Icon button | shadcn Button variant |
| `.icon-btn.delete` | Delete icon button | shadcn Button variant="destructive" |
| `.lines` | Line container | Tailwind flex-col |
| `.line` | Single line row | Tailwind flex |
| `.indent` | Indentation spacer | Tailwind margin |
| `.indent.with-line` | Indent with border | Tailwind border-l |
| `.chip` | Pill/chip element | shadcn Badge |
| `.chip.tag` | Tag chip variant | shadcn Badge variant |
| `.chip.title` | Title chip variant | Tailwind typography |
| `.inline-number` | Inline number input | shadcn Input |
| `.inline-select` | Inline select dropdown | shadcn Select |
| `.placeholder` | Placeholder container | Tailwind relative |
| `.placeholder-btn` | Add node button | shadcn Button variant="outline" |
| `.menu` | Dropdown menu | shadcn DropdownMenu |
| `.slot-body` | Slot content wrapper | Tailwind flex |
| `.add-row` | Add row container | Tailwind flex |
| `.add-more` | Add more button | shadcn Button variant="outline" |

### 4. Color Picker (3 classes)
| CSS Class | Description | Convert To |
|-----------|-------------|------------|
| `.color-picker` | Color picker container | shadcn Popover |
| `.color-menu` | Color grid menu | Tailwind grid |
| `.color-swatch` | Color swatch button | Tailwind + custom |

### 5. Conditions & Positions (5 classes)
| CSS Class | Description | Convert To |
|-----------|-------------|------------|
| `.condition-bubble` | Condition container | Tailwind border + bg |
| `.condition-row` | Condition row | Tailwind flex |
| `.positions` | Positions container | Tailwind flex-col |
| `.position-row` | Position row | Tailwind flex |
| `.capped-chip` | Capped value chip | Tailwind flex |

### 6. Saved Bots List (5 classes)
| CSS Class | Description | Convert To |
|-----------|-------------|------------|
| `.saved-list` | Saved bots container | Tailwind flex-col |
| `.saved-item` | Saved bot card | shadcn Card |
| `.saved-actions` | Saved bot actions | Tailwind flex |
| `.bot-tag` | Bot tag pill | shadcn Badge |
| `.bot-tags` | Bot tags container | Tailwind flex-wrap |

### 7. Backtester Card (18 classes)
| CSS Class | Description | Convert To |
|-----------|-------------|------------|
| `.backtester-card` | Main backtest container | shadcn Card |
| `.backtester-head` | Backtest header | Tailwind flex |
| `.backtester-title` | Backtest title | Tailwind typography |
| `.backtester-controls` | Control inputs row | Tailwind flex-wrap |
| `.backtester-field` | Control field wrapper | Tailwind flex-col |
| `.backtester-body` | Backtest content | Tailwind flex-col |
| `.backtester-chart-placeholder` | Chart placeholder | Tailwind border-dashed |
| `.backtester-message` | Info message | shadcn Alert |
| `.backtester-tabs` | Backtest tabs | shadcn Tabs |
| `.backtester-summary` | Stats summary row | Tailwind flex |
| `.backtester-grid2` | 2-column grid | Tailwind grid |
| `.backtester-legend` | Chart legend | Tailwind flex-wrap |
| `.backtester-table` | Results table | shadcn Table |
| `.backtester-row` | Table row | shadcn TableRow |
| `.backtester-head-row` | Table header row | shadcn TableHeader |
| `.backtester-body-rows` | Table body scroll | shadcn ScrollArea |
| `.build-layout` | Build layout wrapper | Tailwind flex-col |
| `.build-code-zone-scroll` | Scrollable code zone | Tailwind overflow |

### 8. Stats Cards (6 classes)
| CSS Class | Description | Convert To |
|-----------|-------------|------------|
| `.base-stats-grid` | Stats grid container | Tailwind grid |
| `.base-stats-card` | Stats card | shadcn Card |
| `.stat-card` | Individual stat card | shadcn Card |
| `.stat-label` | Stat label text | Tailwind typography |
| `.stat-value` | Stat value text | Tailwind typography |
| `.stat-sub` | Stat subtitle | Tailwind typography |

### 9. Charts & Navigator (14 classes)
| CSS Class | Description | Convert To |
|-----------|-------------|------------|
| `.equity-wrap` | Equity chart wrapper | Tailwind flex-col |
| `.chart-hover-overlay` | Chart tooltip | Tailwind absolute + backdrop |
| `.chart-hover-date` | Tooltip date | Tailwind typography |
| `.chart-hover-stats` | Tooltip stats grid | Tailwind grid |
| `.chart-hover-stat` | Tooltip stat row | Tailwind flex |
| `.chart-hover-label` | Tooltip label | Tailwind typography |
| `.chart-hover-value` | Tooltip value | Tailwind typography |
| `.chart-toolbar` | Chart toolbar | Tailwind flex |
| `.chart-presets` | Preset buttons | Tailwind flex-wrap |
| `.drawdown-wrap` | Drawdown chart wrapper | Tailwind flex-col |
| `.drawdown-head` | Drawdown header | Tailwind flex |
| `.navigator-wrap` | Navigator container | Tailwind block |
| `.navigator-chart-wrap` | Navigator chart container | Tailwind relative |
| `.navigator-overlay` | Navigator overlay | Tailwind absolute inset-0 |
| `.navigator-shade` | Navigator shade | Tailwind absolute + bg |
| `.navigator-window` | Navigator window | Tailwind absolute + border |
| `.navigator-handle` | Navigator drag handle | Tailwind absolute |

### 10. Range Picker (8 classes)
| CSS Class | Description | Convert To |
|-----------|-------------|------------|
| `.range-picker` | Range picker container | shadcn Popover |
| `.range-pill` | Range display pill | shadcn Button variant |
| `.range-popover` | Range popover content | shadcn PopoverContent |
| `.range-popover-row` | Popover input row | Tailwind grid |
| `.range-field` | Range input field | Tailwind flex-col |
| `.range-popover-actions` | Popover actions | Tailwind flex |
| `.range-controls` | Range slider controls | Tailwind border + bg |
| `.range-label` | Range label | Tailwind typography |
| `.range-sliders` | Sliders container | Tailwind grid |

### 11. Monthly Heatmap Table (8 classes)
| CSS Class | Description | Convert To |
|-----------|-------------|------------|
| `.monthly-heatmap` | Heatmap scroll container | shadcn ScrollArea |
| `.monthly-table` | Monthly returns table | shadcn Table |
| `.monthly-table-v2` | Extended monthly table | shadcn Table |
| `.monthly-title` | Table title cell | Tailwind typography |
| `.monthly-group` | Group header row | Tailwind bg |
| `.month-cell` | Month data cell | Tailwind + conditional colors |
| `.year-cell` | Year label cell | Tailwind typography |
| `.year-metric` | Year metric cell | Tailwind bg |

### 12. Portfolio Tab (8 classes)
| CSS Class | Description | Convert To |
|-----------|-------------|------------|
| `.portfolio-grid` | Portfolio layout grid | Tailwind grid |
| `.summary-cards` | Summary cards grid | Tailwind grid |
| `.summary-card` | Summary stat card | shadcn Card |
| `.summary-value` | Summary value text | Tailwind typography |
| `.panel-grid` | Panel layout grid | Tailwind grid |
| `.panel-card` | Panel card | shadcn Card |
| `.panel-title` | Panel title | Tailwind typography |
| `.portfolio-table` | Holdings table | shadcn Table |

### 13. Analyze Tab - Bot List (6 classes)
| CSS Class | Description | Convert To |
|-----------|-------------|------------|
| `.bot-list` | Bot list container | Tailwind grid |
| `.bot-row` | Bot row | Tailwind flex |
| `.bot-row-title` | Bot title | Tailwind flex |
| `.bot-row-meta` | Bot metadata | Tailwind typography |
| `.bot-row-pnl` | Bot P&L display | Tailwind typography |
| `.analyze-ticker-table` | Ticker analysis table | shadcn Table |
| `.analyze-compare-table` | Comparison table | shadcn Table |

### 14. Utility Classes (5 classes)
| CSS Class | Description | Convert To |
|-----------|-------------|------------|
| `.eyebrow` | Eyebrow text style | Tailwind typography |
| `.lede` | Lead paragraph | Tailwind typography |
| `.pnl-positive` | Positive P&L color | Tailwind text-green-* |
| `.pnl-negative` | Negative P&L color | Tailwind text-red-* |
| `.legend-item` | Legend item | Tailwind flex |
| `.legend-swatch` | Legend color swatch | Tailwind rounded-full |
| `.alloc-input` | Allocation input | shadcn Input |
| `.call-ref-wrap` | Call reference wrapper | Tailwind padding |

## Implementation Plan

### Phase 1: Setup & Foundation
1. Install Tailwind CSS, PostCSS, Autoprefixer
2. Configure `tailwind.config.js` with design tokens:
   - Colors: `--bg`, `--surface`, `--text`, `--muted`, `--border`, `--accent-*`, `--danger`, `--success`
   - Border radius: 6px, 8px, 10px, 12px, 14px, 16px (custom)
   - Font weights: 600, 700, 800, 900
3. Add Tailwind directives to index.css
4. Install shadcn/ui CLI and initialize with "new-york" style
5. Install `clsx` and `tailwind-merge` for cn() utility

### Phase 2: Install All shadcn Components
```bash
npx shadcn@latest add button input select card table tabs dropdown-menu popover badge separator scroll-area tooltip dialog alert
```

### Phase 3: Create Base Layout Components
1. Convert `.app` container styles
2. Convert `.app-header` to Tailwind
3. Convert `.canvas` wrapper
4. Set up dark mode toggle with `dark` class on root

### Phase 4: Convert Build Tab
1. Convert `.node-card` to shadcn Card
2. Convert `.lines`, `.line`, `.chip` to Tailwind
3. Convert `.placeholder-btn`, `.menu` to shadcn components
4. Convert all buttons to shadcn Button
5. Convert all inputs/selects to shadcn components
6. Remove all inline styles from node rendering

### Phase 5: Convert Analyze Tab
1. Convert `.saved-item`, `.saved-list` to Tailwind
2. Convert `.base-stats-card`, `.stat-card` to shadcn Card
3. Convert `.backtester-*` components to Tailwind + shadcn
4. Convert `.monthly-table`, `.backtester-table` to shadcn Table
5. Convert chart wrappers to Tailwind
6. Convert `.bot-*` components

### Phase 6: Convert Portfolio Tab
1. Convert `.portfolio-grid`, `.panel-grid` to Tailwind grid
2. Convert `.summary-card`, `.panel-card` to shadcn Card
3. Convert `.portfolio-table` to shadcn Table

### Phase 7: Dark Mode Implementation
1. Configure Tailwind `darkMode: 'class'`
2. Add `dark:` variants to all custom classes
3. Ensure shadcn components respect dark mode
4. Test theme toggle functionality

### Phase 8: Cleanup & Verification
1. Delete App.css
2. Search for any remaining `style={{` in App.tsx - should be zero
3. Search for any remaining `className="` referencing old CSS classes
4. Run build and fix TypeScript errors
5. Run lint and fix issues
6. Manual visual testing of all tabs in light/dark mode

## Open Questions

1. Preferred shadcn/ui style: "default" or "new-york"?
2. Should we extract components from App.tsx during this refactor (e.g., NodeCard, StatCard)?
3. Any specific color palette preferences beyond current theme?
