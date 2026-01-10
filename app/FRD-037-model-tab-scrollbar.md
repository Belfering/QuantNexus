# FRD-037: Model Tab Scrollbar Fix

## Priority: HIGH (Already partially implemented, needs verification)

## Problem
The Model tab scrollbars and floating ETF bar aren't working correctly. The floating scrollbar width doesn't match flowchart content width.

## Current State (Recent Changes)
- Removed `max-width: 100%` from `.node-card` in `App.css`
- Using negative margin trick to hide native scrollbar: `height: calc(100% + 20px)`, `marginBottom: -20px`
- Floating scrollbar syncs via `onScroll` handlers

## Solution
Verify recent changes work correctly:

1. **Test**: Node cards should overflow container, triggering scrollWidth > clientWidth
2. **Test**: Floating scrollbar thumb should reflect actual content width
3. **Test**: Scroll position should sync between flowchart and floating scrollbar

If still broken, investigate:
- Whether MutationObserver is firing correctly
- Whether `scrollWidth` is being measured at the right time
- CSS interactions with `overflow: hidden` on parent containers

### Files to Verify
| File | Check |
|------|-------|
| `src/tabs/ModelTab.tsx:644-658` | Scroll container setup |
| `src/App.tsx:483-518` | Scroll dimension tracking |
| `src/App.tsx:1326-1344` | Floating scrollbar rendering |
| `src/App.css:794-805` | `.node-card` width rules |
