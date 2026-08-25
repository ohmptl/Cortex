// Assignment status
export type AssignmentStatus = 'not_started' | 'in_progress' | 'completed'

export type AssignmentCategory =
  | 'assignment'
  | 'exam'
  | 'quiz'
  | 'homework'
  | 'lab'
  | 'discussion'
  | 'project'
  | 'event'
  | 'other'

// Where an assignment's data originated from
export type AssignmentSource = 'manual' | 'gradescope' | 'moodle'

export interface Assignment {
  id: string
  title: string
  courseId: string | null
  deadline: string // ISO timestamp
  status: AssignmentStatus
  category: AssignmentCategory
  tags: string[]
  notes: string | null

  createdAt: string
  updatedAt: string
  completedAt: string | null

  source: AssignmentSource
  gradescopeId: string | null
  gradescopeCourseId: string | null
  moodleId: string | null
}

export interface AssignmentFormData {
  title: string
  courseId: string | null
  deadline: string
  status: AssignmentStatus
  category: AssignmentCategory
  tags?: string[]
  notes?: string | null
}

export type StatusColor = 'red' | 'yellow' | 'green' | 'gray'

export interface DeadlineDisplay {
  primary: string
  secondary: string
  color: StatusColor
}
