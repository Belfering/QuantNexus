import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import LandingPage from './pages/LandingPage.tsx'
import { AppProvider } from './context'

// Phase-based routing: Show landing page in "coming-soon" mode
// Set VITE_LAUNCH_PHASE=coming-soon to show landing page
// Set VITE_LAUNCH_PHASE=alpha (or undefined) to show the full app
const LAUNCH_PHASE = import.meta.env.VITE_LAUNCH_PHASE || 'alpha'

// Check URL for direct app access (e.g., /app or logged in users)
const isAppRoute = window.location.pathname.startsWith('/app')

// Determine which component to render
const RootComponent = LAUNCH_PHASE === 'coming-soon' && !isAppRoute ? LandingPage : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <RootComponent />
    </AppProvider>
  </StrictMode>,
)
