# Phase 7: Testing & Polish ⬜ PENDING

**Timeline**: Days 17-18
**Status**: ⬜ PENDING

---

## Tasks

- [ ] End-to-end testing of all features
- [ ] Performance benchmarking
- [ ] Documentation updates
- [ ] CLAUDE.md update for new structure

---

## End-to-End Testing Checklist

### Authentication
- [ ] User registration
- [ ] User login
- [ ] Token refresh
- [ ] Logout
- [ ] Display name editing

### Bot Management
- [ ] Create new bot
- [ ] Edit bot (all node types)
- [ ] Duplicate bot
- [ ] Delete bot
- [ ] Import from Composer
- [ ] Import from QuantMage
- [ ] Export bot

### Tree Builder
- [ ] Add nodes (all types)
- [ ] Delete nodes
- [ ] Move nodes (drag and drop)
- [ ] Copy/paste nodes
- [ ] Undo/redo
- [ ] Condition editing
- [ ] Ticker selection (including ratios)

### Backtest
- [ ] Run backtest (CC, COC, OO modes)
- [ ] View equity chart
- [ ] View drawdown chart
- [ ] View allocation chart
- [ ] View monthly heatmap
- [ ] Download backtest data

### Analyze Tab
- [ ] Overview subtab
- [ ] Advanced benchmarks
- [ ] Robustness/fragility report
- [ ] Ticker contributions

### Dashboard
- [ ] View portfolio
- [ ] Buy system
- [ ] Sell system
- [ ] Buy more
- [ ] View equity curve
- [ ] Partner T-Bill chart

### Nexus
- [ ] Browse community systems
- [ ] Search/filter systems
- [ ] View correlations
- [ ] Add to watchlist
- [ ] Buy from Nexus

### Watchlists
- [ ] Create watchlist
- [ ] Add bot to watchlist
- [ ] Remove bot from watchlist
- [ ] Save bot to watchlist

### Admin (admin users only)
- [ ] Atlas Overview
- [ ] Nexus Maintenance
- [ ] Ticker Data management
- [ ] User Management
- [ ] Trading Control (Alpaca)
- [ ] Atlas Systems
- [ ] Database browser

---

## Performance Benchmarks

### Target Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Cold start (new user) | 30+ sec | < 5 sec |
| Cold start (returning) | 30+ sec | < 1 sec |
| Backtest (cached) | N/A | < 100ms |
| Backtest (uncached) | ~2 sec | < 500ms |
| Initial bundle | 1,279 KB | < 1,000 KB |
| Main bundle (gzip) | ~320 KB | < 250 KB |
| Lighthouse Performance | TBD | > 80 |

### Benchmark Script

```bash
# Run performance benchmarks
npm run benchmark

# Expected output:
# Cold start (cached): 0.8s
# Backtest (cache hit): 45ms
# Backtest (cache miss): 380ms
# API response times:
#   GET /api/bots: 12ms
#   POST /api/bots/:id/run-backtest: 85ms
#   GET /api/candles/:ticker: 25ms
```

---

## Documentation Updates

### CLAUDE.md Updates

Update for new project structure:

```markdown
## Project Structure

- **`/System.app/src/features/`**: Feature modules
  - `builder/` - Tree builder components and utils
  - `backtest/` - Backtest engine and charts
  - `dashboard/` - Portfolio dashboard
  - `nexus/` - Community features
  - `analyze/` - Analysis tools
  - `admin/` - Admin panel
  - `auth/` - Authentication
  - `data/` - Data management

- **`/System.app/src/stores/`**: Zustand state stores
  - `useAuthStore.ts` - Auth state
  - `useUIStore.ts` - UI state
  - `useBotStore.ts` - Bot state
  - `useBacktestStore.ts` - Backtest state
  - `useDashboardStore.ts` - Dashboard state
  - `useTreeStore.ts` - Tree state with undo/redo

- **`/System.app/src/hooks/`**: Custom hooks
  - `useTreeSync.ts` - Tree/bot synchronization
  - `useBacktestRunner.ts` - Backtest execution
  - `useAnalyzeRunner.ts` - Analysis handlers
  - etc.

- **`/System.app/server/features/`**: Backend feature modules
  - `auth/` - Auth endpoints
  - `bots/` - Bot CRUD
  - `backtest/` - Backtest engine
  - `nexus/` - Nexus endpoints
  - `data/` - Data endpoints
```

### Feature READMEs

Each feature folder should have a README.md:

```markdown
# Builder Feature

## Overview
The builder feature handles the visual tree editor for creating trading strategies.

## Components
- `NodeCard/` - Tree node rendering
- `InsertMenu.tsx` - Node insertion menu
- `ConditionEditor.tsx` - Condition editing
- etc.

## Hooks
- `useTreeState.ts` - Local tree state
- `useClipboard.ts` - Copy/paste functionality

## Utils
- `treeOperations.ts` - Tree manipulation functions
- `nodeFactory.ts` - Node creation helpers
```

---

## Final Checklist

- [ ] All tests pass
- [ ] No console errors
- [ ] No TypeScript errors
- [ ] Build completes successfully
- [ ] Performance targets met
- [ ] Documentation updated
- [ ] CLAUDE.md accurate
- [ ] Feature READMEs in place
- [ ] No security vulnerabilities
- [ ] Ready for production deployment
