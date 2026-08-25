export interface GradeWeight {
  category: string // e.g. "Quizzes"
  weight: number // percentage, e.g. 20
}

export interface GradedItem {
  id: string
  category: string // matches GradeWeight.category
  name: string
  score: number
  total: number
}

export interface Course {
  id: string
  code: string // e.g. "ECE 306"
  name: string
  color: string // hex, e.g. "#3b82f6"
  instructor: string | null
  gradeWeights: GradeWeight[]
  gradedItems: GradedItem[]
  active: boolean
  createdAt: string
}

export interface CourseFormData {
  code: string
  name: string
  color: string
  instructor?: string | null
  gradeWeights?: GradeWeight[]
  gradedItems?: GradedItem[]
  active?: boolean
}

export const DEFAULT_COURSE_COLORS = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#22c55e', // green
  '#f59e0b', // amber
  '#a855f7', // purple
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
] as const
