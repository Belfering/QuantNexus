// server/features/auth/index.mjs
// Barrel export for auth feature

export { default as authRoutes } from './routes.mjs'

// Re-export middleware for convenience
export {
  authenticate,
  optionalAuth,
  requireAdmin,
  requireMainAdmin,
  requireSuperAdmin,
  hasAdminAccess,
  hasEngineerAccess,
  isMainAdmin,
  isSuperAdmin,
  canChangeUserRole,
  getTierLimits,
  JWT_SECRET,
} from '../../middleware/auth.mjs'
