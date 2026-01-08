// Boot wrapper with debug logging
console.log('[boot] === SERVER STARTING ===')
console.log('[boot] NODE_ENV:', process.env.NODE_ENV)
console.log('[boot] PORT:', process.env.PORT)
console.log('[boot] JWT_SECRET exists:', !!process.env.JWT_SECRET)
console.log('[boot] JWT_SECRET length:', process.env.JWT_SECRET?.length || 0)
console.log('[boot] REFRESH_SECRET exists:', !!process.env.REFRESH_SECRET)
console.log('[boot] REFRESH_SECRET length:', process.env.REFRESH_SECRET?.length || 0)
console.log('[boot] RESEND_API_KEY exists:', !!process.env.RESEND_API_KEY)
console.log('[boot] RESEND_API_KEY prefix:', process.env.RESEND_API_KEY?.substring(0, 6) || 'NOT SET')

process.on('uncaughtException', (err) => {
  console.error('[boot] UNCAUGHT EXCEPTION:', err.message)
  console.error(err.stack)
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('[boot] UNHANDLED REJECTION:', reason)
  process.exit(1)
})

console.log('[boot] Loading main server module...')
import('./index.mjs')
  .then(() => {
    console.log('[boot] Main server module loaded successfully')
  })
  .catch((err) => {
    console.error('[boot] FAILED TO LOAD SERVER:', err.message)
    console.error(err.stack)
    process.exit(1)
  })
