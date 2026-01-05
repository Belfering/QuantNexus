/**
 * Authenticated fetch wrapper with automatic token refresh
 *
 * This module provides a fetch wrapper that:
 * 1. Automatically adds Authorization header with access token
 * 2. Handles 401 responses by refreshing the access token
 * 3. Prevents thundering herd by batching concurrent refresh requests
 *
 * Usage:
 *   import { authFetch } from '@/lib/authFetch'
 *   const res = await authFetch('/api/protected-endpoint')
 */

const API_BASE = '/api'

// Token refresh state - prevents thundering herd problem
let isRefreshing = false
let refreshSubscribers: Array<(token: string) => void> = []

const subscribeTokenRefresh = (cb: (token: string) => void) => {
  refreshSubscribers.push(cb)
}

const onRefreshed = (token: string) => {
  refreshSubscribers.forEach((cb) => cb(token))
  refreshSubscribers = []
}

/**
 * Refresh the access token using the stored refresh token
 */
const refreshAccessToken = async (): Promise<string | null> => {
  const refreshToken =
    localStorage.getItem('refreshToken') || sessionStorage.getItem('refreshToken')
  if (!refreshToken) return null

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const newToken = data.accessToken
    // Store in same location as original
    if (localStorage.getItem('refreshToken')) {
      localStorage.setItem('accessToken', newToken)
    } else {
      sessionStorage.setItem('accessToken', newToken)
    }
    return newToken
  } catch {
    return null
  }
}

/**
 * Get current access token from storage
 */
const getToken = () =>
  localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken')

/**
 * Authenticated fetch wrapper that auto-refreshes tokens on 401
 *
 * @param url - The URL to fetch
 * @param options - Standard RequestInit options
 * @returns Promise<Response>
 */
export const authFetch = async (
  url: string,
  options: RequestInit = {}
): Promise<Response> => {
  let token = getToken()

  const makeRequest = (accessToken: string | null) => {
    const headers = new Headers(options.headers || {})
    if (accessToken) {
      headers.set('Authorization', `Bearer ${accessToken}`)
    }
    return fetch(url, { ...options, headers })
  }

  let response = await makeRequest(token)

  // If 401, try to refresh the token
  if (response.status === 401) {
    if (!isRefreshing) {
      isRefreshing = true
      const newToken = await refreshAccessToken()
      isRefreshing = false

      if (newToken) {
        onRefreshed(newToken)
        // Retry the original request with new token
        response = await makeRequest(newToken)
      }
    } else {
      // Wait for the refresh to complete
      const newToken = await new Promise<string>((resolve) => {
        subscribeTokenRefresh((token) => resolve(token))
      })
      response = await makeRequest(newToken)
    }
  }

  return response
}

export default authFetch
