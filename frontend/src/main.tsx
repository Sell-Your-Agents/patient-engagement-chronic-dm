import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router'
import { useAuthStore } from './store/authStore'
import './index.css'

// Initialize query client
const queryClient = new QueryClient()

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
