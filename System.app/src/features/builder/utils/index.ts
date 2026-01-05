// src/features/builder/utils/index.ts
// Barrel export for builder utilities

// Helpers
export { getAllSlotsForNode, newId } from './helpers'

// Node Factory
export { createNode, ensureSlots, normalizeForImport, createDefaultRoot } from './nodeFactory'

// Tree Operations
export {
  // Normalization
  normalizeComparatorChoice,
  // Core tree operations
  replaceSlot,
  insertAtSlot,
  appendPlaceholder,
  deleteNode,
  removeSlotEntry,
  // Node property updates
  updateTitle,
  updateWeight,
  updateCappedFallback,
  updateVolWindow,
  updateCollapse,
  setAllCollapsed,
  setCollapsedBelow,
  updateColor,
  updateCallReference,
  // Function node operations
  updateFunctionWindow,
  updateFunctionBottom,
  updateFunctionMetric,
  updateFunctionRank,
  // Position node operations
  addPositionRow,
  removePositionRow,
  choosePosition,
  // Condition operations
  addConditionLine,
  deleteConditionLine,
  updateConditionFields,
  // Alt Exit operations
  addEntryCondition,
  addExitCondition,
  deleteEntryCondition,
  deleteExitCondition,
  updateEntryConditionFields,
  updateExitConditionFields,
  // Scaling operations
  updateScalingFields,
  // Numbered node operations
  updateNumberedQuantifier,
  updateNumberedN,
  addNumberedItem,
  deleteNumberedItem,
  // Clone operations
  cloneNode,
  deepCloneForCompression,
  // Search and navigation operations
  findNode,
  cloneAndNormalize,
  expandToNode,
} from './treeOperations'
