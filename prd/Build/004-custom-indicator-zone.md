# PRD 004 - Custom Indicator Zone (Below Call Node Zone)

## Metadata
- ID: 004
- Title: Custom indicator zone (below Call Node Zone)
- Status: draft
- Owner:
- Depends on: Call Node Zone UI, backtest metrics
- Created: 2025-12-17
- Last updated: 2025-12-17

## Summary
Add a new UI zone below the Call Node Zone in the Build tab for creating and managing **custom indicators** that can be referenced by Indicator/Numbered nodes in strategies.

## Goals
- Provide a dedicated area to define custom indicators without cluttering the main flow.
- Allow referencing custom indicators from nodes (by name/ID) in the builder.
- Make custom indicators per-user/per-profile and easy to clear/reset during testing.

## Non-goals
- Full scripting language or marketplace for indicators (v1 is minimal).
- Cross-user sharing (unless later requested).

## UX / UI
- Location: a bubble/box below the Call Node Zone area.
- Contains a list of custom indicators (collapsible items).
- Each indicator has:
  - Name (editable)
  - Definition placeholder (v1: placeholder UI only unless engine spec is provided)
  - Actions: `Create`, `Rename`, `Delete`
- Reference flow: nodes show custom indicators in their metric dropdown (or a separate selector).

## Data Model / State
- `CustomIndicator`:
  - `id`
  - `name`
  - `definition` (TBD; placeholder in v1)
  - `createdAt`, `updatedAt`
- Persisted in the same per-profile storage as bots/watchlists/call chains.

## Acceptance Criteria
- Build tab displays a “Custom Indicators” zone below the Call Node Zone.
- User can add/remove/rename indicators (placeholder definition for now).
- Indicators appear as selectable options when configuring indicator metrics (or in a dedicated selector).
- Data persists per profile and is removed by `Clear Data`.

## Open Questions
- What is the indicator definition format (formula DSL, node graph, JS snippet, etc.)?
- Do indicators require parameters (window length, ticker, etc.)?
- How are indicators validated and surfaced in backtest warnings/errors?

## Implementation Notes
- Start with a placeholder-only editor (name + description) and wire references.
- Once definition format is chosen, implement evaluation in the same cache system as built-in metrics.
