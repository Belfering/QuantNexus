# Phase 1.5: Flowchart Builder Integration - Implementation Plan

## Executive Summary

**Objective:** Add a visual flowchart strategy builder to Atlas Forge that automatically extracts parameters and generates branch combinations for mass backtesting.

**Scope:** Full end-to-end implementation (all 6 phases)
- Visual drag-and-drop flowchart builder (port from Flowchart repo)
- Automatic parameter detection from flowchart conditions
- Parameter range configuration UI
- Python flowchart executor (extend backtester.py)
- Branch generation from parameter combinations
- Backward compatibility with existing simple mode

**Timeline:** 6 weeks (6 phases)

**Key Innovation:** When user builds a flowchart with "10d RSI < 30", the system automatically detects period=10 and threshold=30, creates range controls (e.g., "5-10d" period, "20-40" threshold), and generates all combinations for backtesting.

---

## Architecture Overview

### Mode System
- **Simple Mode (existing):** Single indicator, manual period/threshold ranges
- **Flowchart Mode (new):** Visual builder with automatic parameter extraction
- **Toggle:** Radio buttons at top of ForgeDashboard, persists to localStorage

### State Management
- **Flowchart State:** Zustand store with zundo temporal middleware (undo/redo)
  - Port from `C:\Users\Trader\Desktop\Flowchart-master\System.app\src\stores\useTreeStore.ts`
- **Job Management:** Existing React hooks (useForgeJob, useForgeStream, etc.) - NO CHANGES
- **Parameter Extraction:** Computed hook from Zustand tree state

### Data Flow
```
User builds flowchart
  → Zustand store (auto-saves to localStorage)
  → Parameter extraction hook scans tree
  → User enables/configures parameter ranges
  → Saved to ForgeConfig (localStorage + passed to backend)
  → Backend generates branch combinations
  → Python executes each flowchart instance
  → Results stored in branches table (existing schema)
```

---

## Phase 1: Foundation (Week 1)

**Goal:** Set up types, state, and basic rendering

### Tasks

**Day 1: Type Definitions**
- Create `client/src/types/flowchart.ts`
  - Port FlowNode, ConditionLine, BlockKind from Flowchart repo
  - Add ParameterRange type for extraction
- Extend `client/src/types/forge.ts`:
  ```typescript
  interface ForgeConfig {
    mode: 'simple' | 'flowchart';
    flowchart?: FlowNode;
    parameterRanges?: ParameterRange[];
    // ... existing fields
  }
  ```

**Day 1-2: Zustand Store**
- Create `client/src/stores/useFlowchartStore.ts`
  - Port from Flowchart's useTreeStore.ts (lines 1-200)
  - Install: `npm install zustand zundo`
  - Simplify to indicator blocks only (remove call chains initially)
  - Include temporal middleware for undo/redo

**Day 2: Tree Operations**
- Create `client/src/lib/flowchart/treeOperations.ts`
  - Port from `C:\Users\Trader\Desktop\Flowchart-master\System.app\src\features\builder\utils\treeOperations.ts`
  - Functions: replaceSlot, insertAtSlot, deleteNode, addConditionLine, etc.

**Day 2: Helper Functions**
- Create `client/src/lib/flowchart/helpers.ts`
  - Port newId, ensureSlots, createNode, getAllSlotsForNode
  - Source: Flowchart's utils/helpers.ts and utils/nodeFactory.ts

**Day 3: Basic NodeCard Rendering**
- Create `client/src/components/Flowchart/NodeCard/NodeCard.tsx`
  - Port from Flowchart's NodeCard.tsx (simplified)
  - Support basic and indicator blocks only
  - Static rendering (no editing yet)

**Day 3-4: Test Rendering**
- Create test page with hardcoded flowchart
- Verify rendering works
- Match Atlas Forge Tailwind theme

### Deliverables
- ✅ FlowNode types defined
- ✅ Zustand store with undo/redo functional
- ✅ Tree renders correctly
- ✅ Basic/indicator blocks display

---

## Phase 2: Builder & Editing (Week 2)

**Goal:** Enable full flowchart editing with CRUD operations

### Tasks

**Day 1: Condition Editor**
- Create `client/src/components/Flowchart/ConditionEditor.tsx`
  - Port from Flowchart repo
  - Inputs: metric dropdown, window, comparator, threshold
  - Add/delete condition buttons
  - Support if/and/or logic

**Day 1: Indicator Dropdown**
- Create `client/src/components/Flowchart/IndicatorDropdown.tsx`
  - Port from Flowchart
  - Merge Atlas Forge's `client/src/lib/indicators.ts` with Flowchart's `constants/indicators.ts`
  - Searchable dropdown with categories

**Day 2: Insert Menu**
- Create `client/src/components/Flowchart/InsertMenu.tsx`
  - Port from Flowchart
  - Context menu for adding blocks
  - Initially: basic, indicator, position blocks

**Day 2-3: Wire CRUD Operations**
- Connect NodeCard to Zustand actions
- Test: add node, delete node, edit conditions
- Verify undo/redo works

**Day 3: Flowchart Toolbar**
- Create `client/src/components/Forge/FlowchartToolbar.tsx`
  - Undo/redo buttons (using temporal.undo/redo)
  - Collapse all/expand all
  - Clear flowchart

**Day 4: Integrate into ForgeDashboard**
- Create `client/src/components/Forge/ModeToggle.tsx` (radio buttons or tabs)
- Modify `client/src/components/Forge/ForgeDashboard.tsx`:
  ```tsx
  {config.mode === 'simple' ? (
    <SimpleStrategyEditor config={config} updateConfig={updateConfig} />
  ) : (
    <FlowchartStrategyEditor />
  )}
  ```
- Extract simple mode UI into `client/src/components/Forge/SimpleStrategyEditor.tsx`

### Deliverables
- ✅ Can add/delete indicator blocks
- ✅ Can edit conditions (metric, window, comparator, threshold)
- ✅ Undo/redo works for all operations
- ✅ Mode toggle functional
- ✅ State persists to localStorage

---

## Phase 3: Parameter Extraction (Week 3)

**Goal:** Automatically detect and configure parameter ranges

### Tasks

**Day 1: Parameter Extraction Hook**
- Create `client/src/hooks/useParameterExtraction.ts`:
  ```typescript
  export function useParameterExtraction(flowchart: FlowNode | null): ParameterRange[] {
    // Recursively scan tree for periods and thresholds
    // Return array of detected parameters with metadata
  }
  ```
- Algorithm: Traverse tree, extract node.window and condition.threshold values

**Day 2: Parameter Panel**
- Create `client/src/components/Forge/ParameterExtractionPanel.tsx`:
  ```
  [✓] Indicator Block 1 > RSI > Period
      Current: 14   Min: [5]   Max: [20]   Step: [1]
  [✓] Indicator Block 1 > Condition 1 > Threshold
      Current: 30   Min: [20]  Max: [40]   Step: [1]

  Branch Estimate: 336 branches (16 periods × 21 thresholds)
  ```
- Checkboxes to enable/disable parameters
- Number inputs for min/max/step

**Day 2: Branch Count Estimation**
- Create `client/src/hooks/useFlowchartEstimate.ts`:
  ```typescript
  const estimate = useFlowchartEstimate(parameterRanges, tickerCount);
  // Returns: totalBranches, estimatedSeconds, estimatedMinutes
  ```
- Calculate: product of all enabled parameter ranges × ticker count

**Day 3: Connect to ForgeConfig**
- Extend `client/src/hooks/useForgeConfig.ts`:
  - Include flowchart and parameterRanges in config
  - Save/restore from localStorage
- Validation: min < max, step > 0, enabled parameters > 0

**Day 3-4: Testing**
- Create flowchart with 2 indicator blocks (4 parameters)
- Enable 2 parameters
- Verify branch count: (max-min)/step+1 for each param, multiplied
- Test persistence across page reloads

### Deliverables
- ✅ All periods/thresholds detected automatically
- ✅ Parameter ranges configurable
- ✅ Branch count accurate
- ✅ State persists in localStorage

---

## Phase 4: Python Integration (Week 4)

**Goal:** Execute flowchart strategies in Python

### Tasks

**Day 1-2: FlowchartExecutor Class**
- Create `python/flowchart_executor.py`:
  ```python
  class FlowchartExecutor:
      def execute(self, df: pd.DataFrame, ticker: str) -> pd.DataFrame:
          # Returns df with 'Signal' column (0/1)

      def _execute_node(self, df, node, ticker) -> pd.Series:
          # Recursive execution based on node['kind']

      def _evaluate_conditions(self, df, conditions) -> pd.Series:
          # if/and/or logic, returns True/False series
  ```
- Handle: basic, indicator, position blocks
- Use existing `indicators.py` for metric calculation

**Day 2: Extend backtester.py**
- Add mode routing:
  ```python
  def backtest_branch(params):
      if params.get('mode') == 'flowchart':
          from flowchart_executor import FlowchartExecutor
          executor = FlowchartExecutor(params['flowchart'])
          df = executor.execute(df, ticker)
      else:
          # Existing simple mode logic
  ```
- Integrate with existing calculate_returns and compute_metrics_dict

**Day 3: Update Backend (forge.mjs)**
- Modify `POST /api/forge/estimate`:
  ```javascript
  if (config.mode === 'flowchart') {
    const totalBranches = calculateFlowchartBranches(config.parameterRanges);
    // ...
  }
  ```
- Modify `POST /api/forge/start`:
  ```javascript
  const configJson = JSON.stringify(config);
  const python = spawn('python', ['optimized_forge_engine.py', configJson, jobId]);
  ```
  - Pass full config (mode detected in Python)

**Day 3: Generate Parameter Combinations**
- Add to `python/optimized_forge_engine.py`:
  ```python
  def generate_flowchart_branches(flowchart, parameter_ranges, tickers):
      combinations = generate_combinations(parameter_ranges)
      for ticker in tickers:
          for combo in combinations:
              branch_flowchart = apply_parameter_values(flowchart, combo)
              yield {'ticker': ticker, 'flowchart': branch_flowchart}
  ```

**Day 4: Database Schema**
- Add columns to forge_jobs table:
  ```sql
  ALTER TABLE forge_jobs ADD COLUMN mode TEXT DEFAULT 'simple';
  ALTER TABLE forge_jobs ADD COLUMN flowchart_json TEXT;
  ```
- Update `server/db/schema.mjs` or `server/db/json-db.mjs`

**Day 4-5: End-to-End Test**
- Create flowchart: 1 indicator block (RSI < 30)
- Enable 1 parameter (period 5-10)
- Start job
- Verify:
  - Python receives flowchart JSON
  - 6 branches generated (periods 5-10)
  - Signals calculated correctly
  - Metrics stored in branches table
  - SSE progress updates work

### Deliverables
- ✅ FlowchartExecutor executes basic/indicator blocks
- ✅ Python parses JSON correctly
- ✅ Branch combinations generated
- ✅ Results stored correctly
- ✅ Progress streaming works

---

## Phase 5: Advanced Features (Week 5)

**Goal:** Add all block types and 64 indicators

### Tasks

**Day 1: Numbered Blocks**
- Create `client/src/components/Flowchart/NodeCard/NumberedBody.tsx`
  - any/all/none/exactly/atLeast/atMost logic
- Update FlowchartExecutor:
  ```python
  def _execute_numbered(self, df, node, ticker):
      items = node['numbered']['items']
      quantifier = node['numbered']['quantifier']
      # Evaluate each item's conditions
      # Apply quantifier logic
  ```

**Day 2: Position Blocks**
- Create `client/src/components/Flowchart/NodeCard/PositionBody.tsx`
  - Ticker selection UI
- Update executor:
  ```python
  def _execute_position(self, df, node, ticker):
      if ticker in node['positions']:
          return pd.Series(1, index=df.index)
  ```

**Day 2-3: All 64 Indicators**
- Verify `python/indicators.py` supports all metrics:
  - Price, MA (8 types), RSI (5 variants), Momentum (9), Volatility (10), Trend (7), Aroon (3), MACD/PPO (2), Volume (3)
- Add missing indicators from Flowchart's `constants/indicators.ts`
- Test each category

**Day 3-4: Function/AltExit/Scaling Blocks** (Stretch Goals)
- Port components from Flowchart
- These are advanced features, can defer to Phase 6 if time limited

**Day 4-5: Integration Testing**
- Create complex flowchart:
  - Root: basic block
  - Child 1: indicator block (RSI < 30)
  - Child 2: numbered block (any of 3 conditions)
  - Child 3: position block (SPY, QQQ)
- Enable 2 parameters
- Verify execution produces correct signals

### Deliverables
- ✅ Numbered blocks functional
- ✅ Position blocks filter tickers
- ✅ All 64 indicators work
- ✅ Complex flowcharts execute correctly

---

## Phase 6: Polish & Testing (Week 6)

**Goal:** Production-ready with excellent UX

### Tasks

**Day 1: Performance Optimization**
- Profile React rendering (React DevTools)
- Memoize parameter extraction
- Debounce auto-save (500ms)
- Benchmark Python execution

**Day 1-2: Error Handling**
- Validate flowchart before job start:
  - All indicator blocks have conditions
  - All conditions have metric selected
  - No empty position blocks
- Show friendly errors: "Indicator Block 2 has no conditions"
- Catch Python errors, display in UI

**Day 2-3: UI Polish**
- Loading states for all async operations
- Flowchart canvas scrolling/zoom
- Keyboard shortcuts:
  - Ctrl+Z/Ctrl+Y: Undo/redo
  - Delete: Remove selected node
- Improve parameter panel:
  - Collapsible sections by block
  - Warning if >10,000 branches
- Add tooltips for all buttons

**Day 3: Import/Export**
- Create `client/src/lib/flowchart/importExport.ts`:
  ```typescript
  export function exportFlowchart(flowchart: FlowNode): string {
    return JSON.stringify(flowchart, null, 2);
  }
  export function importFlowchart(json: string): FlowNode {
    const parsed = JSON.parse(json);
    return normalizeForImport(parsed);
  }
  ```
- Add "Export JSON" / "Import JSON" buttons
- Add "Load Example" with pre-built strategies

**Day 4: Documentation**
- User guide: `docs/flowchart-mode-guide.md`
  - How to build flowcharts
  - Parameter extraction explained
  - Examples: simple, intermediate, advanced
- Developer docs: extending block types

**Day 4-5: Integration Testing**
- Switch between modes with active job
- Test parameter persistence
- Test large flowcharts (10+ blocks, 1000+ branches)
- Test concurrent simple + flowchart jobs

**Day 5: UAT & Bugfixes**
- Test all workflows end-to-end
- Fix any critical bugs
- Performance tuning if needed

### Deliverables
- ✅ No console errors
- ✅ Smooth rendering (60 FPS)
- ✅ Clear error messages
- ✅ Import/export works
- ✅ Documentation complete
- ✅ Production-ready

---

## Critical Files Reference

### Files to Create (35+ new files)

**Types:**
- `client/src/types/flowchart.ts` - FlowNode, ConditionLine, ParameterRange

**State Management:**
- `client/src/stores/useFlowchartStore.ts` - Zustand with undo/redo

**Libraries:**
- `client/src/lib/flowchart/treeOperations.ts` - Tree manipulation
- `client/src/lib/flowchart/helpers.ts` - Utilities
- `client/src/lib/flowchart/importExport.ts` - JSON import/export
- `client/src/lib/flowchart/validation.ts` - Flowchart validation

**Hooks:**
- `client/src/hooks/useParameterExtraction.ts` - Detect parameters
- `client/src/hooks/useFlowchartEstimate.ts` - Branch count
- `client/src/hooks/useFlowchartPersistence.ts` - localStorage sync

**Components - Flowchart:**
- `client/src/components/Flowchart/NodeCard/NodeCard.tsx`
- `client/src/components/Flowchart/NodeCard/NodeHeader.tsx`
- `client/src/components/Flowchart/NodeCard/IndicatorBody.tsx`
- `client/src/components/Flowchart/NodeCard/NumberedBody.tsx`
- `client/src/components/Flowchart/NodeCard/PositionBody.tsx`
- `client/src/components/Flowchart/ConditionEditor.tsx`
- `client/src/components/Flowchart/IndicatorDropdown.tsx`
- `client/src/components/Flowchart/InsertMenu.tsx`

**Components - Forge:**
- `client/src/components/Forge/ModeToggle.tsx`
- `client/src/components/Forge/SimpleStrategyEditor.tsx` (extracted)
- `client/src/components/Forge/FlowchartStrategyEditor.tsx`
- `client/src/components/Forge/FlowchartCanvas.tsx`
- `client/src/components/Forge/FlowchartToolbar.tsx`
- `client/src/components/Forge/ParameterExtractionPanel.tsx`

**Python:**
- `python/flowchart_executor.py` - FlowchartExecutor class

### Files to Modify (8 files)

**Types:**
- `client/src/types/forge.ts` - Extend ForgeConfig with mode, flowchart, parameterRanges

**Hooks:**
- `client/src/hooks/useForgeConfig.ts` - Handle flowchart fields, extended validation

**Components:**
- `client/src/components/Forge/ForgeDashboard.tsx` - Add mode toggle, conditional rendering

**Backend:**
- `server/routes/forge.mjs` - Detect mode, route to appropriate backend logic
- `server/db/schema.mjs` (or json-db.mjs) - Add mode, flowchart_json columns

**Python:**
- `python/backtester.py` - Add flowchart mode routing
- `python/optimized_forge_engine.py` - Handle flowchart config, generate combinations
- `python/indicators.py` - Verify/add any missing indicators

---

## Reference Code Locations

### Flowchart Repository
**Base:** `C:\Users\Trader\Desktop\Flowchart-master\System.app\src\`

**Critical files to port:**
- `types/flowNode.ts` → Type definitions
- `stores/useTreeStore.ts` → Zustand store pattern
- `features/builder/utils/treeOperations.ts` → Tree manipulation
- `features/builder/utils/helpers.ts` → Utilities
- `features/builder/utils/nodeFactory.ts` → Node creation
- `features/builder/components/NodeCard/NodeCard.tsx` → Main rendering
- `constants/indicators.ts` → 64 indicator definitions
- `components/ui/*` → shadcn components (already in Atlas Forge)

### Atlas Forge Current
**Base:** `C:\Users\Trader\Desktop\atlas-forge\`

**Key existing files:**
- `client/src/hooks/useForgeConfig.ts` → Extend for flowchart
- `client/src/components/Forge/ForgeDashboard.tsx` → Add mode toggle
- `python/backtester.py` → Add flowchart execution
- `python/indicators.py` → Use for indicator calculations
- `server/routes/forge.mjs` → Add mode routing

---

## Implementation Strategy

### Incremental Delivery
- Each phase delivers testable functionality
- Phase 1-2: UI foundation (can test visually)
- Phase 3: Parameter detection (can verify manually)
- Phase 4: End-to-end execution (first complete workflow)
- Phase 5-6: Enhancement and polish

### Backward Compatibility
- **NO breaking changes to simple mode**
- New `mode` field defaults to 'simple'
- Existing jobs continue to work unchanged
- Database schema changes are additive (new columns)

### Testing Approach
- **Phase 1-3:** Manual UI testing, visual verification
- **Phase 4:** End-to-end integration test with single flowchart
- **Phase 5:** Complex flowchart tests with all block types
- **Phase 6:** Regression testing, performance testing, UAT

### Risk Mitigation
- Port from proven Flowchart codebase (reduce bugs)
- Use existing Zustand + zundo for undo/redo (don't reinvent)
- Extend backtester.py gradually (simple mode unaffected)
- Mode toggle allows users to fall back to simple mode anytime

---

## Success Criteria

### Phase 1-3 Complete (Weeks 1-3)
- [ ] Flowchart builder renders complex nested structures
- [ ] All block types can be added/removed/edited
- [ ] Parameter extraction detects periods and thresholds
- [ ] Parameter ranges configurable with min/max/step
- [ ] Branch count estimation accurate

### Phase 4-6 Complete (Weeks 4-6)
- [ ] Python interpreter executes flowcharts correctly
- [ ] All 64 indicators work in conditions
- [ ] Metrics calculated correctly (match simple mode on equivalent strategies)
- [ ] 10,000+ branch job completes successfully
- [ ] Results tab displays flowchart branches
- [ ] Mode switching works without data loss
- [ ] Flowchart persists across page refreshes
- [ ] Export/import round-trips correctly

### Production Ready
- [ ] No console errors or warnings
- [ ] Error messages are clear and actionable
- [ ] All features work in production build
- [ ] User documentation complete
- [ ] Simple mode still works identically (regression test)

---

## Dependencies

### NPM Packages (Install)
```bash
cd client
npm install zustand zundo
```

### Python Packages (Already Installed)
- pandas, numpy, ta (indicators), pyarrow
- All required packages already in `python/requirements.txt`

### Database Migration
```sql
-- Run in atlas.db or json-db equivalent
ALTER TABLE forge_jobs ADD COLUMN mode TEXT DEFAULT 'simple';
ALTER TABLE forge_jobs ADD COLUMN flowchart_json TEXT;
```

---

## Questions for Clarification (If Any Arise During Implementation)

1. **Weighting Modes:** Should Phase 1.5 implement all weighting modes (equal, inverse, pro, capped) or just equal initially?
   - **Recommendation:** Start with equal weighting, add advanced modes in Phase 5

2. **Position Sizing:** Should flowchart execution support position sizing based on volatility?
   - **Recommendation:** Phase 6 enhancement, not critical for MVP

3. **Multiple Tickers in Flowchart:** Should position blocks support portfolio allocation across multiple tickers?
   - **Recommendation:** Yes, but Phase 5 feature

4. **Trade Logs:** Should flowchart mode generate detailed trade logs like simple mode?
   - **Recommendation:** Yes, use existing trade log system from backtester.py

---

## Estimated Effort

| Phase | Effort (Days) | Risk Level |
|-------|---------------|------------|
| Phase 1: Foundation | 4 days | Low (porting proven code) |
| Phase 2: Builder | 4 days | Low (UI integration) |
| Phase 3: Parameters | 4 days | Medium (new algorithm) |
| Phase 4: Python | 5 days | Medium (core execution logic) |
| Phase 5: Advanced | 5 days | Medium (multiple block types) |
| Phase 6: Polish | 5 days | Low (testing & refinement) |
| **Total** | **27 days** | **Medium** |

**Note:** 27 working days ≈ 5.5 weeks (assuming 5-day work weeks)

---

## Next Steps After Planning

1. **Set up development branch:** `git checkout -b phase-1.5-flowchart-builder`
2. **Install dependencies:** `npm install zustand zundo` in client/
3. **Start Phase 1, Day 1:** Create type definitions
4. **Review plan with stakeholders** (if any)
5. **Begin implementation** following phase order

---

**Plan Status:** ✅ Complete and ready for implementation
**Last Updated:** 2026-01-07
