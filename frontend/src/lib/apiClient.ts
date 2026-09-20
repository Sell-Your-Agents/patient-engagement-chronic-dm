import axios, { AxiosInstance } from 'axios'

export interface ApiError {
  detail: string
}

class ApiClient {
  private client: AxiosInstance
  private token: string | null = null

  constructor() {
    this.client = axios.create({
      baseURL: '/api',
      timeout: 30000,
    })

    // Load token from localStorage
    this.token = localStorage.getItem('access_token')

    // Add auth interceptor
    this.client.interceptors.request.use((config) => {
      if (this.token) {
        config.headers.Authorization = `Bearer ${this.token}`
        console.log('🔑 Auth header set for', config.url)
      } else {
        console.log('❌ No token available for', config.url)
      }
      return config
    })

    // Handle 401 - redirect to login
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          localStorage.removeItem('access_token')
          window.location.href = '/login'
        }
        return Promise.reject(error)
      }
    )
  }

  setToken(token: string) {
    this.token = token
    localStorage.setItem('access_token', token)
  }

  clearToken() {
    this.token = null
    localStorage.removeItem('access_token')
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

  // Care Plans
  async listCarePlans() {
    const response = await this.client.get('/care-plans/')
    return response.data
  }

  // Outreach Calls
  async listOutreachCalls(skip = 0, limit = 50) {
    const response = await this.client.get('/outreach-calls/', {
      params: { skip, limit },
    })
    return response.data
  }

  async getOutreachCall(id: number) {
    const response = await this.client.get(`/outreach-calls/${id}`)
    return response.data
  }

  async initiateCall(data: {
    patient_id: number
    care_plan_id: number
  }) {
    const response = await this.client.post('/outreach-calls/initiate', data)
    return response.data
  }

  async getCallStats() {
    const response = await this.client.get('/outreach-calls/stats/summary')
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

  // Appointments
  async listAppointments(skip = 0, limit = 50) {
    const response = await this.client.get('/appointments/', {
      params: { skip, limit },
    })
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
}

export const apiClient = new ApiClient()
