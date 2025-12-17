# PRD 012 - Build Tab Call Chains (Reusable Node Groups)

## Metadata
- ID: 012
- Title: Build tab call chains (reusable node groups)
- Status: draft
- Owner:
- Depends on:
- Created: 2025-12-15
- Last updated: 2025-12-17

## Summary
Add a “Call” panel on the right of the Build tab that lets users create reusable node chains with unique IDs. Main flowchart nodes can reference these call chains to avoid copy/pasting long sub-flows. Multiple call chains can be created, each collapsible/expandable.

## Goals
- Reduce visual clutter and duplication in large flows.
- Allow composing from reusable sub-flows by reference.
- Keep call chains discoverable and editable without leaving the Build tab.

## Non-goals
- Cross-user sharing or versioning of call chains (unless later requested).

## UX / UI
- Collapsible "Calls" panel, independent of the main "Algo Name Here" chain.
- The Build page is visually split into:
  - Backtester area (top)
  - Bottom "code zone" area containing the flowchart builder (left) and the Call panel (right)
- The Call panel is pegged to the bottom code zone so it never overlaps the backtester/chart area.
- Expand/Collapse control aligns with the top of the main root node ("Algo Name Here" at the start of the base code chain).
  - Expanded: Call panel occupies ~50% of available width and pushes/shrinks the builder area (no overlay).
  - Collapsed: a tall vertical button/tab labeled "Callback Node Zone" sits on the **right edge of the code zone**, and the Calls panel overlays the code when expanded.
- Code + Calls share a single horizontal scrollbar; support `Shift + mouse wheel` for horizontal scrolling (avoid `Ctrl + wheel` since that zooms in browsers).
- Expanded Calls panel may overlap the main builder/code area (instead of pushing it), anchored to the left edge of the code zone.
- "Make new Call" button creates a new call chain area:
  - Auto-generated unique ID (editable label).
  - Canvas/area to add any node(s) like the main flow.
  - Collapsible to save space.
- Allow multiple call chains; always show an affordance to add another.
- Per call chain header actions:
  - `Copy ID` (copies the chain ID)
  - `X` (deletes the call chain after confirmation)
- Main flow nodes can reference a call chain by ID (UI affordance: e.g., a "Call" node type with an ID selector/autocomplete).

## Data Model / State
- `CallChain`: `id`, `name/label`, `nodes` (structure same as main flow), `createdAt`, `updatedAt`.
- References from main flow nodes store `callChainId`.
- Persistence: same mechanism as main Build graph; scoped to logged-in user.

## Acceptance Criteria
- Build tab shows a right-side Call panel, collapsible.
- User can create multiple call chains via “Make new Call”; each gets a unique ID and editable label.
- User can add nodes inside a call chain.
- Main flow supports inserting a Call node that references an existing call chain by ID.
- Saving the Build graph persists call chains and references with the same storage as the main flow (per user).

## Open Questions
- Should call chain edits automatically propagate to all referencing nodes or require explicit refresh?
- Are nested calls allowed (call chain referencing another call chain)?

## Implementation Notes / Recommended UI & Libraries
- Use existing React Flow integration for node editing inside call chains; consider a tabbed or accordion UI inside the right panel for multiple chains.
- Reference UI: a “Call” node type with searchable select/autocomplete for available call chain IDs; prevent dangling references (warn when deleted).
- State persistence: same store as main graph (per user); autosave with debounce.
- Visibility: keep panel collapsible; show counts of chains and unsaved changes indicator.
