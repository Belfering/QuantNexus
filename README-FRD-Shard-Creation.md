# FRD-Shard-Creation Branch

## Feature: Shard Persistence & Bot Builder

This branch implements the ability to save optimization results as "Shards" and combine them into new bots with configurable weighting strategies.

### What are Shards?

Shards are saved collections of optimization branches that passed your filter criteria. They allow you to:
- Save promising branches from optimization runs for later use
- Combine branches from multiple optimization runs
- Generate new bots with different weighting strategies

### Key Features

1. **Save Shards**: After filtering optimization results, save the filtered branches as a named shard
2. **Shards Library**: Browse, select, and manage saved shards (Panel 4 in Forge tab)
3. **Multi-Shard Selection**: Select multiple shards to combine their branches
4. **Weighting Options**:
   - Equal Weight - Each branch gets equal allocation
   - Inverse Volatility - Lower volatility branches get higher weight
   - Pro Volatility - Higher volatility branches get higher weight
   - Capped - Maximum percentage cap per branch position
5. **Bot Generation**: Generate a new bot from selected shards with chosen weighting

### Usage

1. Run an optimization in the Forge tab
2. Filter results using metric filters (Sharpe > 1, CAGR > 10%, etc.)
3. Enter a name and click "Save" to create a shard
4. In the Shards Library (right panel), select saved shards
5. Configure bot name and weighting strategy
6. Click "Generate & Save to Model" to create the bot
7. Switch to Model tab to view and edit the generated bot

### Files Added/Modified

#### New Files
- `System.app/src/types/shard.ts` - Shard type definitions
- `System.app/src/components/Forge/ShardsLibrary.tsx` - Shards library UI component
- `System.app/server/features/shards/` - Backend API for shard persistence

#### Modified Files
- `System.app/server/db/schema.ts` - Added shards and shard_branches tables
- `System.app/server/db/index.mjs` - Database initialization for new tables
- `System.app/server/index.mjs` - API routes for shards CRUD operations
- `System.app/src/stores/useShardStore.ts` - State management for shards
- `System.app/src/tabs/ForgeTab.tsx` - Integration of ShardsLibrary component
- `System.app/src/components/Forge/ShardsCombinedPreview.tsx` - Save shard UI
- `System.app/src/features/optimization/hooks/useBatchBacktest.ts` - Tree persistence fix

### Database Schema

```sql
-- Shards table
CREATE TABLE shards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  filter_summary TEXT,
  branch_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Shard branches table
CREATE TABLE shard_branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shard_id TEXT NOT NULL REFERENCES shards(id),
  branch_id TEXT NOT NULL,
  job_id INTEGER,
  parameter_label TEXT,
  parameter_values TEXT,
  tree_json TEXT,
  condition_ticker TEXT,
  position_ticker TEXT,
  is_sharpe REAL,
  is_cagr REAL,
  is_max_drawdown REAL,
  oos_sharpe REAL,
  oos_cagr REAL,
  oos_max_drawdown REAL
);
```

### API Endpoints

- `GET /api/shards/:userId` - List all shards for a user
- `POST /api/shards/:userId` - Create a new shard with branches
- `GET /api/shards/:userId/:shardId/branches` - Get branches for a shard
- `DELETE /api/shards/:userId/:shardId` - Delete a shard and its branches
