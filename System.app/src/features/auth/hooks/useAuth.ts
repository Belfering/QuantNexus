// src/features/auth/hooks/useAuth.ts
// Authentication state management hook

import { useState, useCallback, useEffect } from 'react'
import type { UserId } from '@/types'
import { CURRENT_USER_KEY } from '@/constants/config'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type AuthState = {
  userId: UserId | null
  userRole: string | null
  userDisplayName: string | null
  isAdmin: boolean
  hasEngineerAccess: boolean
}

export type DisplayNameState = {
  displayNameInput: string
  displayNameSaving: boolean
  displayNameError: string | null
  displayNameSuccess: boolean
  displayNameAvailable: boolean | null
  displayNameChecking: boolean
}

export type AuthActions = {
  setUserId: (id: UserId | null) => void
  setUserRole: (role: string | null) => void
  setUserDisplayName: (name: string | null) => void
  setDisplayNameInput: (value: string) => void
  login: (nextUser: UserId) => void
  logout: () => void
  handleSaveDisplayName: () => Promise<void>
}

export type UseAuthResult = AuthState & DisplayNameState & AuthActions

// ─────────────────────────────────────────────────────────────────────────────
// Initial State Loaders
// ─────────────────────────────────────────────────────────────────────────────

export const loadInitialUserId = (): UserId | null => {
  try {
    const userJson = localStorage.getItem('user')
    if (userJson) {
      const user = JSON.parse(userJson)
      return user.id as UserId
    }
    // Fallback for legacy local-only mode
    const v = localStorage.getItem(CURRENT_USER_KEY)
    return v === '1' || v === '9' || v === 'admin' ? (v as UserId) : null
  } catch {
    return null
  }
}

export const loadInitialUserRole = (): string | null => {
  try {
    const userJson = localStorage.getItem('user')
    if (userJson) {
      const user = JSON.parse(userJson)
      return user.role || null
    }
    return null
  } catch {
    return null
  }
}

export const loadInitialDisplayName = (): string | null => {
  try {
    const userJson = localStorage.getItem('user')
    if (userJson) {
      const user = JSON.parse(userJson)
      return user.displayName || null
    }
    return null
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export const useAuth = (): UseAuthResult => {
  // Core auth state
  const [userId, setUserId] = useState<UserId | null>(loadInitialUserId)
  const [userRole, setUserRole] = useState<string | null>(loadInitialUserRole)
  const [userDisplayName, setUserDisplayName] = useState<string | null>(loadInitialDisplayName)

  // Display name editing state
  const [displayNameInput, setDisplayNameInput] = useState<string>('')
  const [displayNameSaving, setDisplayNameSaving] = useState(false)
  const [displayNameError, setDisplayNameError] = useState<string | null>(null)
  const [displayNameSuccess, setDisplayNameSuccess] = useState(false)
  const [displayNameAvailable, setDisplayNameAvailable] = useState<boolean | null>(null)
  const [displayNameChecking, setDisplayNameChecking] = useState(false)

  // Derived values
  const isAdmin = userRole === 'admin' || userRole === 'main_admin' || userRole === 'sub_admin'
  const hasEngineerAccess = userRole === 'engineer' || userRole === 'sub_admin' || userRole === 'main_admin' || userRole === 'admin'

  // Check display name availability
  const checkDisplayNameAvailability = useCallback(async (name: string) => {
    if (!name.trim() || name.trim().length < 2) {
      setDisplayNameAvailable(null)
      return
    }

    setDisplayNameChecking(true)
    try {
      const token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken')
      const res = await fetch(`/api/user/display-name/check?name=${encodeURIComponent(name.trim())}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      })
      const data = await res.json()
      if (data.available !== undefined) {
        setDisplayNameAvailable(data.available)
        if (!data.available && data.reason) {
          setDisplayNameError(data.reason)
        }
      }
    } catch {
      // Ignore network errors during availability check
    } finally {
      setDisplayNameChecking(false)
    }
  }, [])

  // Debounced display name check
  useEffect(() => {
    if (!displayNameInput.trim()) {
      setDisplayNameAvailable(null)
      setDisplayNameError(null)
      return
    }

    const timeoutId = setTimeout(() => {
      checkDisplayNameAvailability(displayNameInput)
    }, 500) // 500ms debounce

    return () => clearTimeout(timeoutId)
  }, [displayNameInput, checkDisplayNameAvailability])

  // Login - just updates auth state, App.tsx useEffects handle data loading
  const login = useCallback((nextUser: UserId) => {
    try {
      localStorage.setItem(CURRENT_USER_KEY, nextUser)
    } catch {
      // ignore
    }
    // Load role and display name from stored user object
    try {
      const userJson = localStorage.getItem('user')
      if (userJson) {
        const user = JSON.parse(userJson)
        setUserRole(user.role || null)
        setUserDisplayName(user.displayName || null)
      }
    } catch {
      // ignore
    }
    setUserId(nextUser)
  }, [])

  // Logout - clears auth state, App.tsx handles cleanup
  const logout = useCallback(() => {
    try {
      localStorage.removeItem(CURRENT_USER_KEY)
      localStorage.removeItem('user')
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
      sessionStorage.removeItem('accessToken')
      sessionStorage.removeItem('refreshToken')
    } catch {
      // ignore
    }
    setUserId(null)
    setUserRole(null)
    setUserDisplayName(null)
  }, [])

  // Save display name
  const handleSaveDisplayName = useCallback(async () => {
    if (!displayNameInput.trim()) {
      setDisplayNameError('Display name cannot be empty')
      return
    }
    setDisplayNameSaving(true)
    setDisplayNameError(null)
    setDisplayNameSuccess(false)

    try {
      const token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken')
      const res = await fetch('/api/user/display-name', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ displayName: displayNameInput.trim() })
      })

      const data = await res.json()
      if (!res.ok) {
        setDisplayNameError(data.error || 'Failed to update display name')
        return
      }

      // Update state and localStorage
      setUserDisplayName(data.displayName)
      setDisplayNameSuccess(true)

      // Update the stored user object
      try {
        const userJson = localStorage.getItem('user')
        if (userJson) {
          const user = JSON.parse(userJson)
          user.displayName = data.displayName
          localStorage.setItem('user', JSON.stringify(user))
        }
      } catch {
        // ignore
      }
    } catch (err) {
      setDisplayNameError(err instanceof Error ? err.message : 'Failed to update display name')
    } finally {
      setDisplayNameSaving(false)
    }
  }, [displayNameInput])

  return {
    // Auth state
    userId,
    userRole,
    userDisplayName,
    isAdmin,
    hasEngineerAccess,
    // Display name state
    displayNameInput,
    displayNameSaving,
    displayNameError,
    displayNameSuccess,
    displayNameAvailable,
    displayNameChecking,
    // Actions
    setUserId,
    setUserRole,
    setUserDisplayName,
    setDisplayNameInput,
    login,
    logout,
    handleSaveDisplayName,
  }
}
