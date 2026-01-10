import { useState, useEffect } from 'react'
import { Card, CardHeader, CardContent } from './ui/card'
import { Button } from './ui/button'
import { Input } from './ui/input'
import loginBg from '../assets/login-bg.png'

type AuthMode = 'login' | 'register' | 'forgot' | 'resend' | 'reset-password'

export function LoginScreen({ onLogin }: { onLogin: (userId: string) => void }) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [resetToken, setResetToken] = useState<string | null>(null)
  const [oauthProviders, setOauthProviders] = useState<string[]>([])

  // Fetch available OAuth providers
  useEffect(() => {
    fetch('/api/oauth/providers')
      .then(res => res.json())
      .then(data => setOauthProviders(data.providers || []))
      .catch(() => {})
  }, [])

  // Handle URL paths for verify-email, reset-password, and OAuth callback
  useEffect(() => {
    const path = window.location.pathname
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')

    // Handle OAuth callback
    const oauthAccessToken = params.get('oauth_access_token')
    const oauthRefreshToken = params.get('oauth_refresh_token')
    const oauthUserId = params.get('oauth_user_id')
    const oauthError = params.get('oauth_error')

    if (oauthError) {
      setError(decodeURIComponent(oauthError))
      window.history.replaceState({}, '', '/')
    } else if (oauthAccessToken && oauthRefreshToken && oauthUserId) {
      // Store tokens and complete login
      localStorage.setItem('accessToken', oauthAccessToken)
      localStorage.setItem('refreshToken', oauthRefreshToken)
      localStorage.setItem('userId', oauthUserId)
      // Clean up URL
      window.history.replaceState({}, '', '/')
      // Trigger login callback
      onLogin(oauthUserId)
      return
    }

    if (path === '/verify-email' && token) {
      // Call verify API
      fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setSuccess('Email verified successfully! You can now sign in.')
          } else {
            setError(data.error || 'Verification failed. The link may have expired.')
          }
          // Clean up URL
          window.history.replaceState({}, '', '/')
        })
        .catch(() => {
          setError('Verification failed. Please try again.')
          window.history.replaceState({}, '', '/')
        })
    } else if (path === '/reset-password' && token) {
      setResetToken(token)
      setMode('reset-password')
      // Clean up URL but keep in reset mode
      window.history.replaceState({}, '', '/')
    }
  }, [])

  // Load remembered email on mount
  useEffect(() => {
    const remembered = localStorage.getItem('rememberedEmail')
    if (remembered) {
      setEmail(remembered)
      setRememberMe(true)
    }
  }, [])

  const handleLogin = async () => {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Login failed')
        return
      }
      // Handle remember me
      if (rememberMe) {
        localStorage.setItem('rememberedEmail', email.trim())
        localStorage.setItem('accessToken', data.accessToken)
        localStorage.setItem('refreshToken', data.refreshToken)
      } else {
        localStorage.removeItem('rememberedEmail')
        // Use sessionStorage for non-remembered sessions
        sessionStorage.setItem('accessToken', data.accessToken)
        sessionStorage.setItem('refreshToken', data.refreshToken)
      }
      localStorage.setItem('user', JSON.stringify(data.user))
      onLogin(data.user.id)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async () => {
    setError(null)
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, inviteCode: inviteCode.trim(), displayName: displayName.trim() || undefined })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Registration failed')
        return
      }
      setSuccess(data.message || 'Account created! Please check your email to verify.')
      setMode('login')
      setPassword('')
      setConfirmPassword('')
      setInviteCode('')
      setDisplayName('')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleForgotPassword = async () => {
    setError(null)
    if (!email.trim()) {
      setError('Please enter your email address')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to send reset email')
        return
      }
      setSuccess('If an account exists with this email, you will receive a password reset link.')
      setMode('login')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleResendVerification = async () => {
    setError(null)
    if (!email.trim()) {
      setError('Please enter your email address')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to resend verification email')
        return
      }
      setSuccess(data.message || 'If an unverified account exists, a new verification link will be sent.')
      setMode('login')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async () => {
    setError(null)
    if (!resetToken) {
      setError('Invalid reset token')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, newPassword: password })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to reset password')
        return
      }
      setSuccess('Password reset successfully! You can now sign in.')
      setMode('login')
      setPassword('')
      setConfirmPassword('')
      setResetToken(null)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const submit = () => {
    if (mode === 'login') handleLogin()
    else if (mode === 'register') handleRegister()
    else if (mode === 'forgot') handleForgotPassword()
    else if (mode === 'resend') handleResendVerification()
    else if (mode === 'reset-password') handleResetPassword()
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{
        backgroundImage: `url(${loginBg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      }}
    >
      <Card className="w-full max-w-sm backdrop-blur-sm bg-card/95 shadow-xl">
        <CardHeader className="text-center">
          <h1 className="m-0 my-1.5 text-2xl font-extrabold tracking-tight">Atlas Engine</h1>
          <p className="text-sm text-muted">
            {mode === 'login' && 'Sign in to your account'}
            {mode === 'register' && 'Create a new account'}
            {mode === 'forgot' && 'Reset your password'}
            {mode === 'resend' && 'Resend verification email'}
            {mode === 'reset-password' && 'Enter your new password'}
          </p>
        </CardHeader>
        <CardContent className="grid gap-3">
          {success && <div className="text-sm text-green-600 bg-green-50 p-2 rounded">{success}</div>}

          {mode !== 'reset-password' && (
            <label className="grid gap-1.5">
              <div className="font-bold text-xs">Email</div>
              <Input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null); setSuccess(null) }}
                placeholder="you@example.com"
                autoFocus
              />
            </label>
          )}

          {mode !== 'forgot' && mode !== 'resend' && (
            <label className="grid gap-1.5">
              <div className="font-bold text-xs">{mode === 'reset-password' ? 'New Password' : 'Password'}</div>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(null) }}
                  placeholder="••••••••"
                  onKeyDown={(e) => e.key === 'Enter' && mode === 'login' && submit()}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors p-1"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </label>
          )}

          {(mode === 'register' || mode === 'reset-password') && (
            <>
              <label className="grid gap-1.5">
                <div className="font-bold text-xs">Confirm Password</div>
                <div className="relative">
                  <Input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); setError(null) }}
                    placeholder="••••••••"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors p-1"
                    tabIndex={-1}
                  >
                    {showConfirmPassword ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
              </label>
            </>
          )}

          {mode === 'register' && (
            <>
              <label className="grid gap-1.5">
                <div className="font-bold text-xs">Display Nickname <span className="font-normal text-muted">(optional)</span></div>
                <Input
                  value={displayName}
                  onChange={(e) => { setDisplayName(e.target.value); setError(null) }}
                  placeholder="How others will see you"
                />
              </label>
              <label className="grid gap-1.5">
                <div className="font-bold text-xs">Invite Code</div>
                <Input
                  value={inviteCode}
                  onChange={(e) => { setInviteCode(e.target.value); setError(null) }}
                  placeholder="Enter your invite code"
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                />
              </label>
            </>
          )}

          {mode === 'login' && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
              />
              <span className="text-sm text-muted">Remember me</span>
            </label>
          )}

          {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}

          <Button onClick={submit} disabled={loading} className="w-full">
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : mode === 'register' ? 'Create Account' : mode === 'forgot' ? 'Send Reset Link' : mode === 'reset-password' ? 'Reset Password' : 'Resend Verification'}
          </Button>

          {/* OAuth Buttons */}
          {(mode === 'login' || mode === 'register') && oauthProviders.length > 0 && (
            <div className="mt-4">
              <div className="relative flex items-center gap-4 mb-4">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted">or continue with</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="flex gap-2">
                {oauthProviders.includes('google') && (
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 gap-2"
                    onClick={() => window.location.href = '/api/oauth/google'}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Google
                  </Button>
                )}
                {oauthProviders.includes('discord') && (
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 gap-2"
                    onClick={() => window.location.href = '/api/oauth/discord'}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path fill="currentColor" d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                    </svg>
                    Discord
                  </Button>
                )}
                {oauthProviders.includes('github') && (
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 gap-2"
                    onClick={() => window.location.href = '/api/oauth/github'}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path fill="currentColor" d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                    </svg>
                    GitHub
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2 text-center text-sm">
            {mode === 'login' && (
              <>
                <button
                  type="button"
                  onClick={() => { setMode('forgot'); setError(null); setSuccess(null) }}
                  className="text-muted hover:text-foreground transition-colors"
                >
                  Forgot your password?
                </button>
                <button
                  type="button"
                  onClick={() => { setMode('resend'); setError(null); setSuccess(null) }}
                  className="text-muted hover:text-foreground transition-colors"
                >
                  Resend verification email
                </button>
                <div className="text-muted">
                  Don't have an account?{' '}
                  <button
                    type="button"
                    onClick={() => { setMode('register'); setError(null); setSuccess(null) }}
                    className="text-primary hover:underline font-medium"
                  >
                    Sign up
                  </button>
                </div>
              </>
            )}
            {mode === 'register' && (
              <div className="text-muted">
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => { setMode('login'); setError(null); setSuccess(null) }}
                  className="text-primary hover:underline font-medium"
                >
                  Sign in
                </button>
              </div>
            )}
            {mode === 'forgot' && (
              <button
                type="button"
                onClick={() => { setMode('login'); setError(null); setSuccess(null) }}
                className="text-primary hover:underline font-medium"
              >
                Back to sign in
              </button>
            )}
            {mode === 'resend' && (
              <button
                type="button"
                onClick={() => { setMode('login'); setError(null); setSuccess(null) }}
                className="text-primary hover:underline font-medium"
              >
                Back to sign in
              </button>
            )}
            {mode === 'reset-password' && (
              <button
                type="button"
                onClick={() => { setMode('login'); setError(null); setSuccess(null); setResetToken(null); setPassword(''); setConfirmPassword('') }}
                className="text-primary hover:underline font-medium"
              >
                Back to sign in
              </button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
