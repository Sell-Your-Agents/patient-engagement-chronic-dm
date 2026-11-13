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

  // Patient endpoints
  async listPatients(skip = 0, limit = 50) {
    const response = await this.client.get('/patients/', {
      params: { skip, limit },
    })
    return response.data
  }

  async getPatient(id: number) {
    const response = await this.client.get(`/patients/${id}`)
    return response.data
  }

  async createPatient(data: {
    mrn: string
    first_name: string
    last_name: string
    phone_number: string
    preferred_language?: string
  }) {
    const response = await this.client.post('/patients/', data)
    return response.data
  }

  async updatePatient(id: number, data: {
    first_name?: string
    last_name?: string
    phone_number?: string
    preferred_language?: string
    status?: string
  }) {
    const response = await this.client.patch(`/patients/${id}`, data)
    return response.data
  }

  // Conditions
  async listConditions() {
    const response = await this.client.get('/conditions/')
    return response.data
  }

  async getConditionsOverview() {
    const response = await this.client.get('/conditions/overview')
    return response.data
  }

  async updateProtocol(
    conditionId: number,
    data: {
      default_followup_interval_days?: number
      default_followup_interval_minutes?: number | null
      default_call_time?: string | null
      apply_to_plans?: boolean
    }
  ) {
    const response = await this.client.patch(`/conditions/${conditionId}/protocol`, data)
    return response.data
  }

  // Care Plans
  async listPlans() {
    const response = await this.client.get('/plans/')
    return response.data
  }

  async updatePlan(
    id: number,
    data: {
      followup_interval_days?: number
      followup_interval_minutes?: number | null
      next_due_date?: string
      status?: string
      assigned_physician_name?: string | null
      notes?: string | null
    }
  ) {
    const response = await this.client.patch(`/plans/${id}`, data)
    return response.data
  }

  // Calls (inbound + outbound; filter with ?direction=)
  async listCalls(params: { direction?: string; patient_id?: number; status?: string; skip?: number; limit?: number } = {}) {
    const response = await this.client.get('/calls/', { params })
    return response.data
  }

  /** Server-side paged call search (Call Logs page). */
  async searchCalls(params: {
    page: number
    page_size: number
    direction?: string
    date_from?: string
    date_to?: string
    name?: string
    mrn?: string
    phone?: string
  }) {
    const response = await this.client.get('/calls/page', { params })
    return response.data
  }

  async getCall(id: number) {
    const response = await this.client.get(`/calls/${id}`)
    return response.data
  }

  async initiateCall(data: {
    patient_id: number
    plan_id?: number
  }) {
    const response = await this.client.post('/calls/', data)
    return response.data
  }

  async getCallStats(direction?: string) {
    const response = await this.client.get('/calls/stats', { params: { direction } })
    return response.data
  }

  // Callbacks callers asked for (and failed-call retries)
  async listCallbacks(status?: string) {
    const response = await this.client.get('/calls/callbacks', { params: { status } })
    return response.data
  }

  async updateCallback(id: number, data: { status?: string; scheduled_time?: string }) {
    const response = await this.client.patch(`/calls/callbacks/${id}`, data)
    return response.data
  }

  // Staff follow-up on a call: callback at a set time (local clinic time), or call now
  async followUpCall(callId: number, data: { scheduled_time?: string; reason?: string; call_now?: boolean }) {
    const response = await this.client.post(`/calls/${callId}/callback`, data)
    return response.data
  }

  async dialCallback(id: number) {
    const response = await this.client.post(`/calls/callbacks/${id}/dial`)
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

  // Escalations
  async listEscalations(skip = 0, limit = 50) {
    const response = await this.client.get('/escalations/', {
      params: { skip, limit, status: 'open' },
    })
    return response.data
  }

  async getEscalation(id: number) {
    const response = await this.client.get(`/escalations/${id}`)
    return response.data
  }

  async updateEscalation(id: number, data: {
    status?: string
    assigned_to_user_id?: number
    resolution_notes?: string
  }) {
    const response = await this.client.patch(`/escalations/${id}`, data)
    return response.data
  }

  async getEscalationStats() {
    const response = await this.client.get('/escalations/stats/summary')
    return response.data
  }

  // Appointments (phone agent, check-in requests and staff, filtered with query params)
  async listAppointments(params: {
    patient_id?: number
    doctor_id?: number
    status?: string
    source?: string
    date_from?: string
    date_to?: string
  } = {}) {
    const response = await this.client.get('/appointments/', { params: { limit: 1000, ...params } })
    return response.data
  }

  async getAppointment(id: number) {
    const response = await this.client.get(`/appointments/${id}`)
    return response.data
  }

  async createAppointment(data: {
    patient_id: number
    physician_name: string
    scheduled_at: string
  }) {
    const response = await this.client.post('/appointments/', data)
    return response.data
  }

  async confirmAppointment(id: number) {
    const response = await this.client.post(`/appointments/${id}/confirm`)
    return response.data
  }

  async getAvailability(physicianName: string, daysAhead = 14) {
    const response = await this.client.get(
      `/appointments/availability/${physicianName}`,
      { params: { days_ahead: daysAhead } }
    )
    return response.data
  }

  // Analytics
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

  async getKpis() {
    const response = await this.client.get('/analytics/kpis')
    return response.data
  }

  async getKpiTrend(days = 30) {
    const response = await this.client.get('/analytics/kpis/trend', {
      params: { days },
    })
    return response.data
  }

  // Inbound clinic call agent
  async getClinicInfo() {
    const response = await this.client.get('/clinic/info')
    return response.data
  }

  async getClinicStats() {
    const response = await this.client.get('/clinic/stats')
    return response.data
  }

  async listClinicDoctors() {
    const response = await this.client.get('/clinic/doctors')
    return response.data
  }

  async getDoctorAvailability(doctorId: number, days = 7) {
    const response = await this.client.get(`/clinic/doctors/${doctorId}/availability`, {
      params: { days },
    })
    return response.data
  }

  async updateAppointment(id: number, status: 'cancelled' | 'completed') {
    const response = await this.client.patch(`/appointments/${id}`, { status })
    return response.data
  }
}

export const apiClient = new ApiClient()
