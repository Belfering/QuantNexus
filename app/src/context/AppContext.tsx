// src/context/AppContext.tsx
// Minimal shared context - primarily for auth
// Other state remains in App.tsx and is passed as props to tab components

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react'
import type { UserId } from '@/types'
import { useAuth } from '@/features/auth'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type TabId = 'Dashboard' | 'Nexus' | 'Analyze' | 'Model' | 'Help/Support' | 'Admin' | 'Databases'

export type AppContextValue = {
  // Auth (from useAuth hook) - the primary cross-cutting concern
  userId: UserId | null
  userDisplayName: string | null
  isAdmin: boolean
  hasEngineerAccess: boolean
  auth: ReturnType<typeof useAuth>
}

const AppContext = createContext<AppContextValue | null>(null)

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

type AppProviderProps = {
  children: ReactNode
}

export function AppProvider({ children }: AppProviderProps) {
  // Auth - the primary shared state
  const auth = useAuth()
  const { userId, userDisplayName, isAdmin, hasEngineerAccess } = auth

  const value = useMemo<AppContextValue>(() => ({
    userId,
    userDisplayName,
    isAdmin,
    hasEngineerAccess,
    auth,
  }), [userId, userDisplayName, isAdmin, hasEngineerAccess, auth])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useApp(): AppContextValue {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useApp must be used within an AppProvider')
  }
  return context
}
