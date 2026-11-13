import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router'
import { useAuthStore } from './store/authStore'
import { initTheme } from './store/themeStore'
import './index.css'

initTheme()

// Initialize query client
// Data counts as fresh for 20 s, so switching tabs or pages doesn't refetch every query at once.
// Pages that need live data set their own refetchInterval.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, refetchOnWindowFocus: true, retry: 1 },
  },
})

// Load user on app startup
const initializeAuth = async () => {
  const { loadUser } = useAuthStore.getState()
  await loadUser()

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </React.StrictMode>
  )
}

initializeAuth()
