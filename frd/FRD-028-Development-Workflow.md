# FRD-028: Development Branch Workflow

**Status**: PENDING
**Priority**: High (Infrastructure)
**Created**: 2025-12-30

## Problem Statement

Currently, all code changes are committed directly to `master` branch and immediately deployed to Railway production. This creates several issues:

1. **No testing isolation** - Changes go live immediately, risking production bugs
2. **Incremental deploys** - Each small commit triggers a new Railway deploy
3. **No batching** - Cannot accumulate multiple changes and deploy together
4. **Risk of downtime** - Broken code can take down the live site

## Requirements

### 1. Development Branch (`dev`)
- Create a `dev` branch for all ongoing development work
- All Claude Code edits should target `dev` branch by default
- Local testing happens on `dev` branch
- `dev` branch is NOT connected to Railway

### 2. Production Branch (`master` or `main`)
- `master` remains the production branch
- Railway only deploys from `master`
- Only merge to `master` when ready for production release
- Merges should be done via Pull Request or manual merge

### 3. Workflow
```
[Local Development] → [dev branch] → [Test locally] → [PR/Merge to master] → [Railway deploys]
```

## Implementation Plan

### Step 1: Create Development Branch
```bash
git checkout -b dev
git push -u origin dev
```

### Step 2: Set Default Branch for Claude Code
- Update `.claude/settings.local.json` to prefer `dev` branch
- Or simply work on `dev` and only merge when ready

### Step 3: Local Testing Setup
- Run `npm run dev` locally on `dev` branch
- Test all changes before merging
- Use `npm run dev:full` for full stack (frontend + API)

### Step 4: Production Deploy Process
When ready to deploy:
```bash
# Option A: Direct merge
git checkout master
git merge dev
git push origin master  # Triggers Railway deploy

# Option B: Pull Request (recommended for review)
gh pr create --base master --head dev --title "Release: [description]"
# Review and merge PR on GitHub
```

### Step 5: Post-Deploy
```bash
# Return to dev for continued work
git checkout dev
# Optionally sync dev with master
git merge master
```

## Railway Configuration

Railway is already configured to deploy from `master` branch. No changes needed.

Current setup:
- **Build Command**: `npm run build`
- **Start Command**: `npm start`
- **Branch**: `master`
- **Auto-deploy**: On push to `master`

## Benefits

1. **Isolated development** - Break things without affecting production
2. **Batched releases** - Accumulate many changes, deploy once
3. **Testing time** - Thoroughly test before going live
4. **Rollback safety** - Can easily revert master if issues arise
5. **Clean history** - Production branch has clean, release-focused commits

## Files to Modify

| File | Change |
|------|--------|
| Git branches | Create `dev` branch |
| `.claude/settings.local.json` | Optional: set default branch preference |

## Acceptance Criteria

- [ ] `dev` branch exists and is pushed to origin
- [ ] Local development workflow works on `dev`
- [ ] Can merge `dev` to `master` when ready
- [ ] Railway only deploys when `master` is updated
- [ ] Claude Code workflow updated to use `dev` by default

## Notes

- This is standard Git Flow / GitHub Flow practice
- No code changes required - just workflow changes
- Can start immediately after creating the branch
