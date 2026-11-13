import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useAuthStore } from '../store/authStore'
import { Icon, type IconName } from '../components/Icon'
import { Spinner, ThemeToggle } from '../components/ui'
import { toast } from '../components/toast'
import { BASE_PATH } from '../lib/paths'

const HIGHLIGHTS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'phoneCall', title: 'Automated check-in calls', text: 'Voice agent follows each care plan on schedule' },
  { icon: 'shield', title: 'Red-flag escalation', text: 'Warning signs reach the care team in minutes' },
  { icon: 'calendar', title: 'Callbacks & bookings', text: 'Patients reschedule and book without waiting on hold' },
]

// Dark overlay keeps text readable over the photo; the accent tint ties it to the theme.
const HERO_BG = {
  backgroundImage: `linear-gradient(115deg, rgba(10,22,33,.95) 0%, rgba(12,30,42,.84) 45%, color-mix(in srgb, var(--hero-2) 62%, transparent) 100%), url('${BASE_PATH}login-bg.jpg')`,
}

function BrandMark() {
  return (
    <span className="mark">
      <Icon name="pulse" className="h-5 w-5 text-white" strokeWidth={2.4} />
    </span>
  )
}

export function LoginPage() {
  const navigate = useNavigate()
  const { login, error, isLoading } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await login(email, password)
      const name = useAuthStore.getState().user?.name
      toast.success(`Welcome back${name ? `, ${name}` : ''}`, 'Signed in to the care team console')
      navigate({ to: '/' })
    } catch {
      // error shown from the store
    }
  }

  return (
    <div className="login-bg relative flex min-h-screen" style={HERO_BG}>
      <div className="login-grid pointer-events-none absolute inset-0" />

      {/* Hero */}
      <section className="relative hidden flex-1 flex-col justify-between p-10 text-white lg:flex xl:p-14">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <div className="brand-txt">
            <b>PatientPulse</b>
            <span className="!text-[#8fa1b3]">Chronic care console</span>
          </div>
        </div>

        <div className="max-w-[560px]">
          <span className="glass inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold" style={{ color: 'color-mix(in srgb, var(--accent-2) 55%, white)' }}>
            <span className="dot" /> AI care agent on duty around the clock
          </span>
          <h1 className="mt-5 text-[40px] font-black leading-[1.1] tracking-[-0.02em] xl:text-[46px]">
            Every chronic patient checked on.
            <span className="block" style={{ color: 'color-mix(in srgb, var(--accent-2) 70%, white)' }}>
              Every warning sign caught.
            </span>
          </h1>
          <p className="mt-4 max-w-[480px] text-[15px] leading-relaxed text-[#c3d0dc]">
            PatientPulse calls patients with diabetes, hypertension, COPD and asthma, records how they are doing, and brings the
            cases that need a clinician to your team.
          </p>

          <svg viewBox="0 0 560 70" className="mt-7 h-14 w-full max-w-[520px]" fill="none" aria-hidden="true">
            <path
              className="ecg-line"
              d="M0 40 H150 L165 40 L178 12 L194 62 L208 22 L220 40 H330 L342 40 L352 28 L362 40 H560"
              stroke="color-mix(in srgb, var(--accent-2) 65%, white)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>

          <div className="mt-6 grid gap-3 xl:grid-cols-3">
            {HIGHLIGHTS.map((h) => (
              <div key={h.title} className="glass rounded-xl p-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: 'var(--accent)' }}>
                  <Icon name={h.icon} className="h-[17px] w-[17px]" />
                </span>
                <p className="mt-3 text-sm font-bold">{h.title}</p>
                <p className="mt-1 text-xs leading-snug text-[#b9c6d4]">{h.text}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-[#8fa1b3]">Patient information is shown only to signed-in care team members.</p>
      </section>

      {/* Form */}
      <section className="login-form-side relative flex w-full items-center justify-center p-4 sm:p-8 lg:w-[520px] lg:shrink-0 xl:w-[560px]">
        <div className="login-pop w-full max-w-[400px] rounded-2xl bg-card p-7 shadow-lift sm:p-9 lg:rounded-none lg:bg-transparent lg:p-0 lg:shadow-none">
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 lg:hidden">
              <BrandMark />
              <div className="brand-txt">
                <b>PatientPulse</b>
                <span>Care team console</span>
              </div>
            </div>
            <span className="hidden lg:block" />
            <ThemeToggle />
          </div>

          <div className="mt-6">
            <div className="lbl !text-brand">Care team sign in</div>
            <h2 className="mt-2 text-[28px] font-black tracking-[-0.01em]">Welcome back</h2>
            <p className="mt-1.5 text-sm text-ink-muted">Sign in to review calls, escalations and appointments.</p>
          </div>

          {error && (
            <div className="alertbox login-pop mt-6 !items-start !text-[13px]">
              <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          <form onSubmit={submit} className="mt-7 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-bold">Work email</span>
              <span className="relative block">
                <Icon name="mail" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                <input
                  id="em"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@clinic.com"
                  autoComplete="email"
                  className="field !h-[46px] !pl-10"
                  required
                />
              </span>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[13px] font-bold">Password</span>
              <span className="relative block">
                <Icon name="lock" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                <input
                  id="pw"
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  className="field !h-[46px] !pl-10 !pr-11"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-ink-muted transition hover:text-ink"
                  title={show ? 'Hide password' : 'Show password'}
                >
                  <Icon name={show ? 'eyeOff' : 'eye'} className="h-4 w-4" />
                </button>
              </span>
            </label>

            <button type="submit" disabled={isLoading} className="btn p !mt-6 !h-12 w-full !text-[14px]">
              {isLoading ? (
                <>
                  <Spinner /> Signing in…
                </>
              ) : (
                <>
                  Sign in <Icon name="chevronRight" className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 rounded-xl border border-dashed border-line bg-card-2 px-4 py-3 text-xs text-ink-muted">
            <span className="font-bold text-ink">Demo account:</span> test@hospital.com / TestPass123!
          </div>
        </div>
      </section>
    </div>
  )
}
