// src/features/auth/index.ts
// Auth feature - authentication and user management

export {
  type AuthState,
  type DisplayNameState,
  type AuthActions,
  type UseAuthResult,
  useAuth,
  loadInitialUserId,
  loadInitialUserRole,
  loadInitialDisplayName,
} from './hooks/useAuth'

// Re-export preferences API functions
export {
  loadPreferencesFromApi,
  savePreferencesToApi,
  loadCallChainsFromApi,
} from './api/preferences'
