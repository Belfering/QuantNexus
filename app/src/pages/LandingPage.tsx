import { useState, useEffect } from 'react'

interface FeatureCardProps {
  title: string
  description: string
  icon: React.ReactNode
}

function FeatureCard({ title, description, icon }: FeatureCardProps) {
  return (
    <div className="bg-surface p-6 rounded-xl border border-border">
      <div className="text-accent mb-4">{icon}</div>
      <h3 className="text-lg font-bold text-text mb-2">{title}</h3>
      <p className="text-muted text-sm">{description}</p>
    </div>
  )
}

export function LandingPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error' | 'exists'>('idle')
  const [position, setPosition] = useState<number | null>(null)
  const [waitlistCount, setWaitlistCount] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')

  // Fetch waitlist count on mount
  useEffect(() => {
    fetch('/api/waitlist/stats')
      .then(res => res.json())
      .then(data => setWaitlistCount(data.count || 0))
      .catch(() => {})
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('loading')
    setErrorMessage('')

    try {
      const res = await fetch('/api/waitlist/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const data = await res.json()

      if (res.ok) {
        setStatus('success')
        setPosition(data.position)
        setWaitlistCount(prev => prev + 1)
      } else if (res.status === 409) {
        setStatus('exists')
        setPosition(data.position)
      } else {
        setStatus('error')
        setErrorMessage(data.error || 'Something went wrong')
      }
    } catch {
      setStatus('error')
      setErrorMessage('Network error. Please try again.')
    }
  }

  return (
    <div className="min-h-screen bg-bg">
      {/* Hero Section */}
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        {/* Logo */}
        <div className="mb-8">
          <h1 className="text-5xl md:text-6xl font-black text-text tracking-tight">
            Quant<span className="text-accent">Nexus</span>
          </h1>
        </div>

        <p className="text-xl md:text-2xl text-muted mb-4">
          Build, backtest, and deploy trading algorithms visually.
        </p>
        <p className="text-lg text-muted mb-12">
          No coding required.
        </p>

        {/* Waitlist Form */}
        {status === 'success' || status === 'exists' ? (
          <div className="bg-success/10 border border-success/30 rounded-xl p-8 max-w-md mx-auto">
            <div className="text-success text-3xl mb-3">
              {status === 'success' ? "You're on the list!" : "You're already on the list!"}
            </div>
            <p className="text-text">
              You're <span className="font-black text-accent">#{position}</span> on the waitlist.
            </p>
            <p className="text-muted text-sm mt-2">
              We'll email you when it's your turn.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="max-w-md mx-auto">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                className="flex-1 px-4 py-3 rounded-lg bg-surface border border-border text-text
                           placeholder:text-muted focus:border-accent focus:outline-none
                           focus:ring-2 focus:ring-accent/20 transition-all"
                required
              />
              <button
                type="submit"
                disabled={status === 'loading'}
                className="px-8 py-3 bg-accent hover:bg-accent/90 text-white rounded-lg font-bold
                           disabled:opacity-50 disabled:cursor-not-allowed transition-all
                           whitespace-nowrap"
              >
                {status === 'loading' ? 'Joining...' : 'Join Waitlist'}
              </button>
            </div>
            {status === 'error' && (
              <p className="text-danger text-sm mt-3">{errorMessage}</p>
            )}
          </form>
        )}

        {/* Social Proof */}
        {waitlistCount > 0 && (
          <p className="text-muted mt-8 text-sm">
            <span className="font-bold text-text">{waitlistCount.toLocaleString()}</span> people on the waitlist
          </p>
        )}

        {/* Coming Soon Badge */}
        <div className="mt-12">
          <span className="inline-block px-4 py-2 bg-accent/10 text-accent rounded-full text-sm font-semibold">
            Alpha launching soon
          </span>
        </div>
      </div>

      {/* Features Preview */}
      <div className="max-w-5xl mx-auto px-4 py-16">
        <h2 className="text-2xl font-black text-text text-center mb-12">
          What you'll get
        </h2>
        <div className="grid md:grid-cols-3 gap-6">
          <FeatureCard
            title="Visual Algorithm Builder"
            description="Drag and drop blocks to create complex trading strategies. No coding required."
            icon={
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
              </svg>
            }
          />
          <FeatureCard
            title="Instant Backtesting"
            description="Test your strategies against 35+ years of historical data in seconds."
            icon={
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            }
          />
          <FeatureCard
            title="27,500+ Tickers"
            description="Access every US stock and ETF. Full market coverage for your strategies."
            icon={
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
              </svg>
            }
          />
        </div>
      </div>

      {/* Already have an invite? */}
      <div className="text-center py-12 border-t border-border">
        <a href="/login" className="text-accent hover:underline">
          Already have an invite code? Sign in here →
        </a>
      </div>

      {/* Footer */}
      <footer className="text-center py-8 text-muted text-sm border-t border-border">
        <p>© 2025 QuantNexus. All rights reserved.</p>
      </footer>
    </div>
  )
}

export default LandingPage
