export type ConflictResolution = 'keep_manual' | 'use_synced' | 'keep_both'

export type ConflictSource = 'gradescope' | 'moodle'

// Raised when an auto-synced assignment looks like it might be a duplicate
// of an existing manual entry — surfaced in the UI for the user to resolve.
export interface SyncConflict {
  id: string
  manualAssignmentId: string
  source: ConflictSource
  sourceTitle: string
  sourceDeadline: string
  sourceCourseId: string
  sourceCourseName: string
  sourceData: Record<string, unknown>
  resolved: boolean
  resolution: ConflictResolution | null
  createdAt: string
  resolvedAt: string | null
}
