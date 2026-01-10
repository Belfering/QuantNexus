# Agent Handoff: FRD-030 Phase 2N-8 (Hooks Extraction)

## Current State

- **App.tsx**: 4,238 lines (down from ~21,000 original)
- **Build**: Passing
- **Bundle**: 925 KB (gzip: 241 KB)
- **Branch**: `feature/frd-030-architecture-overhaul`

## What Was Completed

### Phase 2N-12 (Just Finished)
- Extracted OHLC functions to `features/data/api/ohlc.ts`
- Extracted `buildPriceDb` to `features/backtest/utils/priceDb.ts`
- Removed duplicate watchlist/preferences API functions from App.tsx
- Updated all imports

### Previously Completed
- Phase 1: Feature-based directory structure
- Phase 2N-1 to 2N-7: Tab extraction (all 7 tabs lazy-loaded)
- Phase 2N-11: Duplicate code removal (~1,778 lines)
- Phase 2N-12: Pure function extractions (~342 lines)

## Next Task: Phase 2N-8/9/10 - Hooks Extraction

Extract ~203 hook usages from App.tsx into focused custom hooks.

### Detailed Plan Location
**Read this file first**: `System.app/AGENT-PLAN-HOOKS-EXTRACTION.md`

It contains:
- 14 hooks to create with exact line numbers
- Execution order (start with simple hooks)
- Example extraction pattern
- Success criteria

### Quick Reference - Hooks to Create

| Priority | Hook | Lines | Location |
|----------|------|-------|----------|
| 1 | useTickerModal | ~50 | src/hooks/useTickerModal.ts |
| 2 | useFindReplace | ~100 | src/hooks/useFindReplace.ts |
| 3 | useIndicatorOverlays | ~80 | src/hooks/useIndicatorOverlays.ts |
| 4 | useSaveMenu | ~50 | src/hooks/useSaveMenu.ts |
| 5 | useAuthState | ~150 | src/hooks/useAuthState.ts |
| 6 | useUIState | ~150 | src/hooks/useUIState.ts |
| 7 | useTickerState | ~150 | src/hooks/useTickerState.ts |
| 8 | useCommunityState | ~100 | src/hooks/useCommunityState.ts |
| 9 | useBotSessions | ~200 | src/hooks/useBotSessions.ts |
| 10 | useSavedBots | ~250 | src/hooks/useSavedBots.ts |
| 11 | useDashboardState | ~200 | src/hooks/useDashboardState.ts |
| 12 | useCallChains | ~100 | src/hooks/useCallChains.ts |
| 13 | useTreeCallbacks | ~400 | src/hooks/useTreeCallbacks.ts |
| 14 | useBacktestState | ~300 | src/hooks/useBacktestState.ts |

### Execution Pattern

For each hook:
1. Create file in `src/hooks/`
2. Move useState declarations from App.tsx
3. Move related useCallback functions
4. Move related useEffect functions
5. Move related useMemo functions
6. Export from `src/hooks/index.ts`
7. Import and destructure in App.tsx
8. Run `npm run build` to verify
9. Test manually

### Key Files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Main component (4,238 lines) |
| `src/hooks/index.ts` | Barrel file (stub created) |
| `AGENT-PLAN-HOOKS-EXTRACTION.md` | Detailed extraction plan |
| `frd/FRD-030-Scalable-Architecture-Overhaul.md` | Full FRD spec |

### Commands

```bash
cd /Users/carter/Code/Flowchart/System.app
npm run build    # Verify no errors
npm run dev      # Test the app
```

### Important Notes

1. **Start with simple hooks** (useTickerModal, useFindReplace) to establish pattern
2. **Don't extract callbacks that depend on multiple hooks' state** - leave in App.tsx
3. **Watch for circular dependencies** - hooks shouldn't import each other
4. **Test after each extraction** - don't batch multiple without testing
5. **Large backtest callbacks** may need to stay in App.tsx or go to feature-specific files

### Expected Result

- App.tsx: ~2,000-2,500 lines (from 4,238)
- 14 new hook files in `src/hooks/`
- Build still passing
- App functioning correctly

### Git Notes

- Branch: `feature/frd-030-architecture-overhaul`
- **Do not push to GitHub without user approval**
- **Do not merge to master**
