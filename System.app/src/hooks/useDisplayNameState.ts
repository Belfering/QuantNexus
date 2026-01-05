import { useState, useCallback, useEffect } from 'react'

export interface UseDisplayNameStateReturn {
  displayNameInput: string
  setDisplayNameInput: React.Dispatch<React.SetStateAction<string>>
  displayNameSaving: boolean
  setDisplayNameSaving: React.Dispatch<React.SetStateAction<boolean>>
  displayNameError: string | null
  setDisplayNameError: React.Dispatch<React.SetStateAction<string | null>>
  displayNameSuccess: boolean
  setDisplayNameSuccess: React.Dispatch<React.SetStateAction<boolean>>
  displayNameAvailable: boolean | null
  setDisplayNameAvailable: React.Dispatch<React.SetStateAction<boolean | null>>
  displayNameChecking: boolean
  setDisplayNameChecking: React.Dispatch<React.SetStateAction<boolean>>
  checkDisplayNameAvailability: (name: string) => Promise<void>
}

export function useDisplayNameState(): UseDisplayNameStateReturn {
  // Display name UI state
  const [displayNameInput, setDisplayNameInput] = useState<string>('')
  const [displayNameSaving, setDisplayNameSaving] = useState(false)
  const [displayNameError, setDisplayNameError] = useState<string | null>(null)
  const [displayNameSuccess, setDisplayNameSuccess] = useState(false)
  const [displayNameAvailable, setDisplayNameAvailable] = useState<boolean | null>(null)
  const [displayNameChecking, setDisplayNameChecking] = useState(false)

  // Check display name availability (debounced)
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

  // Debounced availability check effect
  useEffect(() => {
    if (!displayNameInput.trim()) {
      setDisplayNameAvailable(null)
      return
    }

    const timeoutId = setTimeout(() => {
      checkDisplayNameAvailability(displayNameInput)
    }, 500) // 500ms debounce

    return () => clearTimeout(timeoutId)
  }, [displayNameInput, checkDisplayNameAvailability])

  return {
    displayNameInput,
    setDisplayNameInput,
    displayNameSaving,
    setDisplayNameSaving,
    displayNameError,
    setDisplayNameError,
    displayNameSuccess,
    setDisplayNameSuccess,
    displayNameAvailable,
    setDisplayNameAvailable,
    displayNameChecking,
    setDisplayNameChecking,
    checkDisplayNameAvailability,
  }
}
