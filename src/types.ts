export type SessionStatus = 'completed' | 'abandoned'

export type Subject = {
  id: string
  name: string
  color: string
  createdAt: string
}

export type FocusSession = {
  id: string
  subjectId: string
  title: string
  plannedDuration: number
  actualDuration: number
  startedAt: string
  endedAt: string
  status: SessionStatus
  pauseCount: number
  pauseDuration: number
  distractionCount: number
  breakCount: number
  createdAt: string
}
