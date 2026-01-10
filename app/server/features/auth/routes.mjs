// server/features/auth/routes.mjs
// Authentication routes - consolidates existing auth routes

import express from 'express'

// Import existing auth routes
import existingAuthRoutes from '../../routes/auth.mjs'
import passwordResetRoutes from '../../routes/password-reset.mjs'

const router = express.Router()

// Mount existing auth routes at /api/auth/*
// These include: register, login, logout, refresh, verify-email, resend-verification, me
router.use('/', existingAuthRoutes)

// Mount password reset routes
// These include: /forgot-password, /reset-password
router.use('/', passwordResetRoutes)

export default router
