export interface MoodleIntegration {
  connected: boolean
  url: string | null
  username: string | null
  lastSync: string | null
}

export interface MoodleConnectRequest {
  url: string
  username: string
  token: string
}

export interface MoodleAssignment {
  id: string
  title: string
  courseId: string
  courseName: string
  deadline: string
}
