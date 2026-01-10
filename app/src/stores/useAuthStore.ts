import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UserId } from '@/types'

interface AuthState {
  // Core auth
  userId: UserId | null
  userRole: string | null
  userDisplayName: string | null

  // Computed from userRole
  isAdmin: boolean
  hasEngineerAccess: boolean

  // Display name editing state (from useDisplayNameState hook)
  displayNameInput: string
  displayNameSaving: boolean
  displayNameError: string | null
  displayNameSuccess: boolean
  displayNameAvailable: boolean | null
  displayNameChecking: boolean

  // Actions
  setUser: (userId: UserId | null, userRole: string | null, userDisplayName: string | null) => void
  logout: () => void

  // Display name actions
  setDisplayNameInput: (input: string) => void
  setDisplayNameSaving: (saving: boolean) => void
  setDisplayNameError: (error: string | null) => void
  setDisplayNameSuccess: (success: boolean) => void
  setDisplayNameAvailable: (available: boolean | null) => void
  setDisplayNameChecking: (checking: boolean) => void
  setUserDisplayName: (name: string | null) => void

  // Async actions
  checkDisplayNameAvailability: (name: string) => Promise<void>
  saveDisplayName: () => Promise<void>
}

// Helper to compute role-based access
function computeRoleAccess(role: string | null) {
  const isAdmin = role === 'admin' || role === 'main_admin' || role === 'sub_admin'
  const hasEngineerAccess = role === 'engineer' || role === 'sub_admin' || role === 'main_admin' || role === 'admin'
  return { isAdmin, hasEngineerAccess }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Initial state
      userId: null,
      userRole: null,
      userDisplayName: null,
      isAdmin: false,
      hasEngineerAccess: false,

      displayNameInput: '',
      displayNameSaving: false,
      displayNameError: null,
      displayNameSuccess: false,
      displayNameAvailable: null,
      displayNameChecking: false,

      // Core auth actions
      setUser: (userId, userRole, userDisplayName) => {
        const { isAdmin, hasEngineerAccess } = computeRoleAccess(userRole)
        set({
          userId,
          userRole,
          userDisplayName,
          isAdmin,
          hasEngineerAccess,
        })
      },

      logout: () => set({
        userId: null,
        userRole: null,
        userDisplayName: null,
        isAdmin: false,
        hasEngineerAccess: false,
        displayNameInput: '',
        displayNameError: null,
        displayNameSuccess: false,
        displayNameAvailable: null,
      }),

      // Display name state setters
      setDisplayNameInput: (displayNameInput) => set({ displayNameInput }),
      setDisplayNameSaving: (displayNameSaving) => set({ displayNameSaving }),
      setDisplayNameError: (displayNameError) => set({ displayNameError }),
      setDisplayNameSuccess: (displayNameSuccess) => set({ displayNameSuccess }),
      setDisplayNameAvailable: (displayNameAvailable) => set({ displayNameAvailable }),
      setDisplayNameChecking: (displayNameChecking) => set({ displayNameChecking }),
      setUserDisplayName: (userDisplayName) => set({ userDisplayName }),

      // Check if display name is available (debounced externally)
      checkDisplayNameAvailability: async (name: string) => {
        if (!name.trim() || name.trim().length < 2) {
          set({ displayNameAvailable: null })
          return
        }

        set({ displayNameChecking: true })
        try {
          const token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken')
          const res = await fetch(`/api/user/display-name/check?name=${encodeURIComponent(name.trim())}`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
          })
          const data = await res.json()
          if (data.available !== undefined) {
            set({ displayNameAvailable: data.available })
            if (!data.available && data.reason) {
              set({ displayNameError: data.reason })
            }
          }
        } catch {
          // Ignore network errors during availability check
        } finally {
          set({ displayNameChecking: false })
        }
      },

      // Save display name to API
      saveDisplayName: async () => {
        const { displayNameInput, setDisplayNameSaving, setDisplayNameError } = get()

        if (!displayNameInput.trim()) {
          setDisplayNameError('Display name cannot be empty')
          return
        }

        setDisplayNameSaving(true)
        setDisplayNameError(null)
        set({ displayNameSuccess: false })

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

          // Update state
          set({ userDisplayName: data.displayName, displayNameSuccess: true })

          // Update the stored user object in localStorage
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

          // Clear success message after 3 seconds
          setTimeout(() => set({ displayNameSuccess: false }), 3000)
        } catch {
          setDisplayNameError('Network error. Please try again.')
        } finally {
          setDisplayNameSaving(false)
        }
      },
    }),
    {
      name: 'auth-storage',
      // Only persist core auth data, not transient UI state
      partialize: (state) => ({
        userId: state.userId,
        userRole: state.userRole,
        userDisplayName: state.userDisplayName,
      }),
    }
  )
)
