// Where the app and its API live. Locally both are at the site root ("/" and "/api");
// on the dev server they come from .env.production (e.g. "/patientpulse/" and "/patientpulse-api/api").

/** Base path of the frontend, always ending in "/" (from Vite's `base`). */
export const BASE_PATH = import.meta.env.BASE_URL

/** Router basepath: same as BASE_PATH without the trailing slash ("/" stays "/"). */
export const ROUTER_BASEPATH = BASE_PATH.replace(/\/+$/, '') || '/'

/** Prefix for all API calls. */
export const API_BASE = import.meta.env.VITE_API_BASE || '/api'

/** Full browser URL of the login page. */
export const LOGIN_URL = `${BASE_PATH}login`
