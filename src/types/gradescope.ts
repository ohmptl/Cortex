export interface GradescopeIntegration {
  connected: boolean
  email: string | null
  lastSync: string | null
  tokenExpiry: string | null
}

export interface GradescopeAssignment {
  id: string
  title: string
  courseId: string
  courseName: string
  deadline: string
  pointsPossible?: number
  submissionStatus?: 'submitted' | 'not_submitted' | 'late'
}

export interface GradescopeCourse {
  id: string
  name: string
  shortName: string
  term: string
}

export interface ConnectRequest {
  email: string
  password: string
}

export interface StatusResponse {
  connected: boolean
  email?: string
  lastSync?: string
  tokenExpiry?: string
}
