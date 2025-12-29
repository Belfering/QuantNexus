import { useState } from 'react'
import { Card, CardHeader, CardContent } from './ui/card'
import { Button } from './ui/button'
import { Input } from './ui/input'

type AuthMode = 'login' | 'register' | 'forgot'

export function LoginScreen({ onLogin }: { onLogin: (userId: string) => void }) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

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
      localStorage.setItem('accessToken', data.accessToken)
      localStorage.setItem('refreshToken', data.refreshToken)
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
        body: JSON.stringify({ email: email.trim(), password, inviteCode: inviteCode.trim() })
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

  const submit = () => {
    if (mode === 'login') handleLogin()
    else if (mode === 'register') handleRegister()
    else if (mode === 'forgot') handleForgotPassword()
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <h1 className="m-0 my-1.5 text-2xl font-extrabold tracking-tight">Atlas Engine</h1>
          <p className="text-sm text-muted">
            {mode === 'login' && 'Sign in to your account'}
            {mode === 'register' && 'Create a new account'}
            {mode === 'forgot' && 'Reset your password'}
          </p>
        </CardHeader>
        <CardContent className="grid gap-3">
          {success && <div className="text-sm text-green-600 bg-green-50 p-2 rounded">{success}</div>}

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

          {mode !== 'forgot' && (
            <label className="grid gap-1.5">
              <div className="font-bold text-xs">Password</div>
              <Input
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null) }}
                placeholder="••••••••"
                onKeyDown={(e) => e.key === 'Enter' && mode === 'login' && submit()}
              />
            </label>
          )}

          {mode === 'register' && (
            <>
              <label className="grid gap-1.5">
                <div className="font-bold text-xs">Confirm Password</div>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setError(null) }}
                  placeholder="••••••••"
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

          {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}

          <Button onClick={submit} disabled={loading} className="w-full">
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : mode === 'register' ? 'Create Account' : 'Send Reset Link'}
          </Button>

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
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
