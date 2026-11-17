import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import { API_BASE, LOGIN_URL } from './paths'

export interface ApiError {
  detail: string
}

/** Whether browser calling is set up, and the URLs to enter in the Twilio console. */
export interface BrowserCallStatus {
  /** Direct test call (no Twilio) needs only the AI, speech and voice keys */
  direct_ready: boolean
  direct_missing: string[]
  /** CLINIC_INBOUND_NUMBER, once the clinic has a real number ("" until then) */
  inbound_number: string
  /** Twilio Voice SDK browser calling is set up */
  configured: boolean
  missing: string[]
  voice_url: string
  status_url: string
  recording_default: boolean
  agent_name: string
  clinic_name: string
}

const ACCESS_KEY = 'access_token'
const REFRESH_KEY = 'refresh_token'

function readStore(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStore(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // storage blocked: the session simply won't survive a reload
  }
}

/** Seconds until a JWT's `exp`, or -1 if it can't be read. */
function secondsLeft(token: string | null) {
  if (!token) return -1
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.exp === 'number' ? payload.exp - Date.now() / 1000 : -1
  } catch {
    return -1
  }
}

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean }

class ApiClient {
  private client: AxiosInstance
  private token: string | null = null
  private refreshToken: string | null = null
  /** One refresh at a time; every request that hit a 401 waits for the same one. */
  private refreshing: Promise<string> | null = null

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE,
      timeout: 30000,
    })

    this.token = readStore(ACCESS_KEY)
    this.refreshToken = readStore(REFRESH_KEY)

    this.client.interceptors.request.use((config) => {
      if (this.token) {
        config.headers.Authorization = `Bearer ${this.token}`
      }
      return config
    })

    // Access token expired: refresh once, retry the request, sign out only if refreshing fails
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const original = error.config as RetriableConfig | undefined
        const isAuthCall = original?.url?.startsWith('/auth/login') || original?.url?.startsWith('/auth/refresh')
        if (error.response?.status === 401 && original && !original._retried && !isAuthCall && this.refreshToken) {
          original._retried = true
          try {
            const token = await this.refreshAccessToken()
            original.headers.Authorization = `Bearer ${token}`
            return this.client(original)
          } catch {
            this.signOutAndRedirect()
            return Promise.reject(error)
          }
        }
        if (error.response?.status === 401 && !isAuthCall) this.signOutAndRedirect()
        return Promise.reject(error)
      },
    )
  }

  private signOutAndRedirect() {
    this.clearToken()
    if (!window.location.pathname.endsWith('/login')) window.location.href = LOGIN_URL
  }

  /** Swap the refresh token for a new pair. Concurrent callers share one request. */
  refreshAccessToken(): Promise<string> {
    if (!this.refreshToken) return Promise.reject(new Error('No refresh token'))
    if (!this.refreshing) {
      // A bare axios call, so the 401 interceptor above can't loop on it
      this.refreshing = axios
        .post(`${API_BASE}/auth/refresh`, { refresh_token: this.refreshToken }, { timeout: 15000 })
        .then((res) => {
          this.setTokens(res.data.access_token, res.data.refresh_token)
          return res.data.access_token as string
        })
        .finally(() => {
          this.refreshing = null
        })
    }
    return this.refreshing
  }

  /** A token that is valid for at least another minute (refreshing first if needed). For websockets. */
  async getFreshToken(): Promise<string | null> {
    if (this.token && secondsLeft(this.token) > 60) return this.token
    if (!this.refreshToken) return this.token
    try {
      return await this.refreshAccessToken()
    } catch {
      return null
    }
  }

  setTokens(access: string, refresh?: string | null) {
    this.token = access
    writeStore(ACCESS_KEY, access)
    if (refresh) {
      this.refreshToken = refresh
      writeStore(REFRESH_KEY, refresh)
    }
  }

  /** Kept for existing callers: sets only the access token. */
  setToken(token: string) {
    this.setTokens(token)
  }

  clearToken() {
    this.token = null
    this.refreshToken = null
    writeStore(ACCESS_KEY, null)
    writeStore(REFRESH_KEY, null)
  }

  hasSession() {
    return Boolean(this.token || this.refreshToken)
  }

  // Auth endpoints
  async register(data: {
    name: string
    email: string
    phone: string
    password: string
    role: string
  }) {
    const response = await this.client.post('/auth/register', data)
    return response.data
  }

  async login(email: string, password: string) {
    const response = await this.client.post('/auth/login', { email, password })
    return response.data
  }

  async getCurrentUser() {
    const response = await this.client.get('/auth/me')
    return response.data
  }

  // Patients (callers)
  async listPatients(params: { q?: string; skip?: number; limit?: number } = {}) {
    const response = await this.client.get('/patients/', { params })
    return response.data
  }

  async getPatient(id: number) {
    const response = await this.client.get(`/patients/${id}`)
    return response.data
  }

  async createPatient(data: { name: string; phone_number: string; preferred_language?: string; notes?: string | null }) {
    const response = await this.client.post('/patients/', data)
    return response.data
  }

  async updatePatient(id: number, data: { name?: string; phone_number?: string; preferred_language?: string; notes?: string | null }) {
    const response = await this.client.patch(`/patients/${id}`, data)
    return response.data
  }

  async patientFollowUps(id: number) {
    const response = await this.client.get(`/patients/${id}/follow-ups`)
    return response.data
  }

  // Call records
  async searchCalls(params: {
    page: number
    page_size: number
    q?: string
    intent?: string
    language?: string
    booking_status?: string
    patient_id?: number
    date_from?: string
    date_to?: string
  }) {
    const response = await this.client.get('/calls/', { params })
    return response.data
  }

  async liveCalls() {
    const response = await this.client.get('/calls/live')
    return response.data
  }

  async callBySid(sid: string) {
    const response = await this.client.get(`/calls/by-sid/${encodeURIComponent(sid)}`)
    return response.data
  }

  async getCall(id: number) {
    const response = await this.client.get(`/calls/${id}`)
    return response.data
  }

  // Follow-ups (staff callbacks)
  async listFollowUps(params: { status?: string; kind?: string } = {}) {
    const response = await this.client.get('/follow-ups/', { params })
    return response.data
  }

  async createFollowUp(data: {
    patient_name: string
    phone_number: string
    reason?: string
    doctor_requested?: string
    preferred_time?: string
    priority?: string
  }) {
    const response = await this.client.post('/follow-ups/', data)
    return response.data
  }

  async updateFollowUp(id: number, data: { status?: string; staff_notes?: string; follow_up_at?: string }) {
    const response = await this.client.patch(`/follow-ups/${id}`, data)
    return response.data
  }

  // Browser calling ("Call the Agent" page, Twilio Voice SDK)
  async browserCallStatus(): Promise<BrowserCallStatus> {
    const response = await this.client.get('/browser-call/status')
    return response.data
  }

  async browserCallToken(): Promise<{ token: string; identity: string }> {
    const response = await this.client.post('/browser-call/token')
    return response.data
  }

  // Appointments
  async listAppointments(params: {
    patient_id?: number
    doctor_id?: number
    status?: string
    source?: string
    date_from?: string
    date_to?: string
  } = {}) {
    const response = await this.client.get('/appointments/', { params })
    return response.data
  }

  async createAppointment(data: {
    patient_name: string
    phone_number: string
    doctor_id: number
    start_at: string
    reason?: string
    confirmed?: boolean
  }) {
    const response = await this.client.post('/appointments/', data)
    return response.data
  }

  async updateAppointment(
    id: number,
    data: { status?: string; doctor_id?: number; start_at?: string; staff_notes?: string },
  ) {
    const response = await this.client.patch(`/appointments/${id}`, data)
    return response.data
  }

  // Notifications (bell)
  async listNotifications() {
    const response = await this.client.get('/notifications/')
    return response.data
  }

  async markNotificationsRead(keys: string[]) {
    await this.client.post('/notifications/read', { keys })
  }

  async markAllNotificationsRead() {
    await this.client.post('/notifications/read-all')
  }

  async clearNotifications(keys: string[]) {
    await this.client.post('/notifications/clear', { keys })
  }

  async clearAllNotifications() {
    await this.client.post('/notifications/clear-all')
  }

  // Dashboard
  async getDashboard(days = 14) {
    const response = await this.client.get('/analytics/dashboard', { params: { days } })
    return response.data
  }

  // Clinic configuration
  async getClinicInfo() {
    const response = await this.client.get('/clinic/info')
    return response.data
  }

  async listClinicDoctors() {
    const response = await this.client.get('/clinic/doctors')
    return response.data
  }

  async saveDoctor(id: number | null, data: unknown) {
    const response = id ? await this.client.put(`/clinic/doctors/${id}`, data) : await this.client.post('/clinic/doctors', data)
    return response.data
  }

  async getDoctorAvailability(doctorId: number, days = 7) {
    const response = await this.client.get(`/clinic/doctors/${doctorId}/availability`, { params: { days } })
    return response.data
  }

  async listKnowledge() {
    const response = await this.client.get('/clinic/knowledge')
    return response.data
  }

  async saveKnowledge(id: number | null, data: unknown) {
    const response = id ? await this.client.put(`/clinic/knowledge/${id}`, data) : await this.client.post('/clinic/knowledge', data)
    return response.data
  }

  async deleteKnowledge(id: number) {
    await this.client.delete(`/clinic/knowledge/${id}`)
  }
}

export const apiClient = new ApiClient()
