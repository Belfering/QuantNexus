/**
 * API Configuration
 *
 * Centralized API base URL configuration for connecting to backend services.
 *
 * Environment Variables:
 * - VITE_API_URL: Override the default API URL
 *   - Production: Set to QuantNexus server (e.g., https://quantnexus.example.com)
 *   - Development with remote: Set to http://178.156.221.28:8787 (or use SSH tunnel)
 *   - Development with local: http://localhost:8787 (default)
 *
 * Usage:
 * ```typescript
 * import { API_BASE_URL } from '@/config/api'
 *
 * const response = await fetch(`${API_BASE_URL}/api/endpoint`)
 * ```
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787'

export { API_BASE_URL }
