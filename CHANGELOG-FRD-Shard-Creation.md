# Changelog - FRD-Shard-Creation Branch

All notable changes for the Shard Persistence & Bot Builder feature.

## [Unreleased]

### Added

- **Shard Types** (`src/types/shard.ts`)
  - `ShardListItem` - Metadata for shard list display
  - `ShardBranch` - Individual branch data within a shard
  - `SaveShardRequest` / `SaveShardResponse` - API request/response types

- **Shards Library Component** (`src/components/Forge/ShardsLibrary.tsx`)
  - Panel 4 UI for saved shards management
  - Multi-select shards with checkboxes
  - Weighting dropdown: Equal, Inverse Volatility, Pro Volatility, Capped
  - Capped percentage input (0-100%) when Capped weighting selected
  - Equal weight percentage display showing allocation per branch
  - Bot name input field
  - Generate & Save to Model button
  - Delete shard functionality

- **Backend API** (`server/features/shards/`)
  - `GET /api/shards/:userId` - List shards
  - `POST /api/shards/:userId` - Create shard with branches
  - `GET /api/shards/:userId/:shardId/branches` - Get shard branches
  - `DELETE /api/shards/:userId/:shardId` - Delete shard

- **Database Tables** (`server/db/schema.ts`)
  - `shards` table for shard metadata
  - `shard_branches` table for branch data with metrics

- **Store Actions** (`src/stores/useShardStore.ts`)
  - `fetchShards()` - Load saved shards from API
  - `saveShard()` - Save filtered branches as a shard
  - `deleteShard()` - Remove a shard
  - `selectShard()` / `deselectShard()` - Toggle shard selection
  - `loadSelectedShards()` - Load branches from selected shards
  - `setShardBotName()` - Set name for generated bot
  - `setShardWeighting()` - Set weighting mode
  - `setShardCappedPercent()` - Set cap percentage for capped weighting
  - `generateBotFromShards()` - Generate FlowNode tree from selected shards

### Changed

- **ShardsCombinedPreview** (`src/components/Forge/ShardsCombinedPreview.tsx`)
  - Added "Save as Shard" section with name input and save button
  - Only visible when "All Runs" is selected in filter groups

- **ForgeTab** (`src/tabs/ForgeTab.tsx`)
  - Integrated ShardsLibrary component as 4th panel
  - Connected all shard-related props and callbacks
  - Fixed bot generation to include tree in history (was empty)

- **useBatchBacktest** (`src/features/optimization/hooks/useBatchBacktest.ts`)
  - Added `tree: modifiedTree` to branchResult for database persistence
  - Ensures future optimizations save the full tree structure

### Fixed

- **Bot generation creates empty tree** - The generated tree was being saved to API but not added to the local bot store's history array. Fixed by changing `history: []` to `history: [tree]` and `historyIndex: -1` to `historyIndex: 0` in ForgeTab.tsx

- **Fallback nodes were empty** - When branches don't have `treeJson`, the fallback now creates meaningful nodes using `parameterLabel` as title and `positionTicker` for positions

## Commit History

1. `e377029` - Feat: Add Shards tab for combining optimization branches
2. `3ed7d1a` - Docs: Update deployment branch from master to main
3. `d876824` - Feat: Multi-job loading and improved branch display for Shards tab
4. `acdc70b` - Feat: Additive filtering with undo for Shards tab
5. `d17d625` - Feat: Filter group dropdown with reference counting for Shards
6. `b046a23` - Chore: Remove undo button from Shards filtered branches

## Testing Checklist

- [ ] Run optimization and filter results
- [ ] Save filtered branches as a shard
- [ ] Verify shard appears in Shards Library
- [ ] Select multiple shards
- [ ] Verify branch count and deduplication
- [ ] Test each weighting option:
  - [ ] Equal Weight (shows percentage per branch)
  - [ ] Inverse Volatility
  - [ ] Pro Volatility
  - [ ] Capped (shows cap % input)
- [ ] Generate bot with each weighting
- [ ] Verify bot appears in Model tab with correct structure
- [ ] Delete a shard and verify removal
