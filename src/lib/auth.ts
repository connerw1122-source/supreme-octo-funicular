// Simple credential-based auth for technicians.
// In a real deployment, swap this for NextAuth.js with proper password hashing.

export const TECH_USERNAME = 'Yoda'
export const TECH_PASSWORD = 'changeme'

const SESSION_KEY = 'marqueeit_session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 8 // 8 hours

export interface AuthSession {
  username: string
  expiresAt: number
}

export function verifyCredentials(username: string, password: string): boolean {
  return username.trim() === TECH_USERNAME && password === TECH_PASSWORD
}

// Client-side helpers (localStorage based)
export function saveSession(username: string) {
  const session: AuthSession = {
    username,
    expiresAt: Date.now() + SESSION_TTL_MS,
  }
  if (typeof window !== 'undefined') {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  }
  return session
}

export function getSession(): AuthSession | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(SESSION_KEY)
  if (!raw) return null
  try {
    const session = JSON.parse(raw) as AuthSession
    if (session.expiresAt < Date.now()) {
      localStorage.removeItem(SESSION_KEY)
      return null
    }
    return session
  } catch {
    return null
  }
}

export function clearSession() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(SESSION_KEY)
  }
}
