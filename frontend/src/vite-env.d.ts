/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public path the app is served under, e.g. "/patientpulse/" (default "/") */
  readonly VITE_BASE_PATH?: string
  /** Where API calls go, e.g. "/patientpulse-api/api" (default "/api") */
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
