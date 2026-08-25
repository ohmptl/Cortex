export interface MoodleIntegration {
  connected: boolean
  url: string | null
  username: string | null
  lastSync: string | null
}

export interface MoodleConnectRequest {
  url: string
  username: string
  // one of these — token auth is preferred, password is a fallback
  token?: string
  password?: string
}

export interface MoodleAssignment {
  id: string
  title: string
  courseId: string
  courseName: string
  deadline: string
}
