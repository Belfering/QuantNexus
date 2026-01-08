// src/tabs/index.ts
// Tab components barrel export
// These components are designed for lazy loading with React.lazy()

// Re-export props types (for type-safe prop passing)
export type { AdminTabProps } from './AdminTab'
export type { DatabasesTabProps } from './DatabasesTab'

// Default exports are used by React.lazy():
// const AdminTab = lazy(() => import('./tabs/AdminTab'))
// const DatabasesTab = lazy(() => import('./tabs/DatabasesTab'))
