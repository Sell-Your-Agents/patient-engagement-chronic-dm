import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useAuthStore } from '../store/authStore'
import { Icon } from '../components/Icon'
import { LogoMark, BRAND_NAME, BRAND_TAGLINE } from '../components/Logo'

export function LoginPage() {
  const navigate = useNavigate()
  const { login, error, isLoading } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await login(email, password)
      navigate({ to: '/' })
    } catch (err) {
      // Error is handled by the store
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="clay w-full max-w-[420px] p-8">
        <div className="mb-7 flex flex-col items-center text-center">
          <LogoMark size={60} />
          <p className="logo-text mt-4 text-[28px] font-extrabold leading-none tracking-tight">{BRAND_NAME}</p>
          <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-muted">{BRAND_TAGLINE}</p>
          <h1 className="mt-6 text-xl font-extrabold text-ink">Welcome back</h1>
          <p className="mt-1 text-sm text-ink-soft">Sign in to your care team account</p>
        </div>

        {error && (
          <div className="mb-5 flex items-center gap-2 rounded-2xl bg-rose-50 p-3.5 text-sm font-semibold text-rose-700">
            <Icon name="alert" className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-bold text-ink-soft">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="test@hospital.com"
              className="clay-input"
              required
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold text-ink-soft">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="clay-input"
              required
            />
          </div>

          <button type="submit" disabled={isLoading} className="clay-btn !mt-6 w-full !py-3">
            {isLoading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-ink-muted">Demo: test@hospital.com / TestPass123!</p>
      </div>
    </div>
  )
}
