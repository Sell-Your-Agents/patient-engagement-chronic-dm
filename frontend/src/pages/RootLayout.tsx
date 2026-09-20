import { useEffect } from 'react'
import { Outlet, useNavigate, useLocation } from '@tanstack/react-router'
import { useAuthStore } from '../store/authStore'

export function RootLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAuthenticated } = useAuthStore()

  useEffect(() => {
    if (!isAuthenticated && location.pathname !== '/login') {
      navigate({ to: '/login' })
    }
  }, [isAuthenticated, navigate, location.pathname])

  return (
    <div className="min-h-screen bg-gray-50">
      {isAuthenticated && (
        <nav className="bg-white shadow">
          <div className="max-w-7xl mx-auto px-4 py-4">
            <div className="flex justify-between items-center">
              <h1 className="text-2xl font-bold">Patient Engagement</h1>
              <div className="flex gap-4">
                <a href="/" className="text-blue-600 hover:underline">Dashboard</a>
                <a href="/patients" className="text-blue-600 hover:underline">Patients</a>
                <a href="/escalations" className="text-blue-600 hover:underline">Escalations</a>
                <a href="/appointments" className="text-blue-600 hover:underline">Appointments</a>
                <a href="/calls" className="text-blue-600 hover:underline">Calls</a>
                <button
                  onClick={() => useAuthStore.getState().logout()}
                  className="text-red-600 hover:underline"
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        </nav>
      )}
      <main className="max-w-7xl mx-auto px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
