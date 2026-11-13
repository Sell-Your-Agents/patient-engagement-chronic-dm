import { create } from 'zustand'
import { apiClient } from '../lib/apiClient'
import { LOGIN_URL } from '../lib/paths'

export interface User {
  id: number
  name: string
  email: string
  role: string
  is_active: boolean
}

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  login: (email: string, password: string) => Promise<void>
  register: (data: {
    name: string
    email: string
    phone: string
    password: string
    role: string
  }) => Promise<void>
  logout: () => void
  loadUser: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,

  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null })
    try {
      const response = await apiClient.login(email, password)
      apiClient.setTokens(response.access_token, response.refresh_token)
      set({
        user: response.user,
        isAuthenticated: true,
        isLoading: false,
      })
    } catch (error: any) {
      set({
        error: error.response?.data?.detail || 'Login failed',
        isLoading: false,
      })
      throw error
    }
  },

  register: async (data) => {
    set({ isLoading: true, error: null })
    try {
      await apiClient.register(data)
      set({ isLoading: false })
    } catch (error: any) {
      set({
        error: error.response?.data?.detail || 'Registration failed',
        isLoading: false,
      })
      throw error
    }
  },

  logout: () => {
    apiClient.clearToken()
    set({
      user: null,
      isAuthenticated: false,
      error: null,
    })
    window.location.href = LOGIN_URL
  },

  loadUser: async () => {
    if (!apiClient.hasSession()) {
      set({ isAuthenticated: false })
      return
    }

    try {
      // An expired access token is refreshed automatically by the API client
      const user = await apiClient.getCurrentUser()
      set({ user, isAuthenticated: true })
    } catch (error) {
      apiClient.clearToken()
      set({ isAuthenticated: false, user: null })
    }
  },
}))
