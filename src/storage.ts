import Database from '@tauri-apps/plugin-sql'
import type { FocusSession, Subject } from './types'

type StorageMode = 'sqlite' | 'local'
type NewSubject = Pick<Subject, 'name' | 'color'>

const LOCAL_SUBJECTS_KEY = 'urchin.subjects'
const LOCAL_SESSIONS_KEY = 'urchin.sessions'
const LEGACY_LOCAL_SUBJECTS_KEY = 'learning-tool.subjects'
const LEGACY_LOCAL_SESSIONS_KEY = 'learning-tool.sessions'
const LEGACY_DEFAULT_SUBJECT_NAMES = new Set([
  '算法题',
  '八股',
  'Java',
  '绠楁硶棰?',
  '鍏偂',
])

let mode: StorageMode = 'local'
let db: Database | null = null

export async function initStore(): Promise<StorageMode> {
  try {
    db = await Database.load('sqlite:urchin.db')
    await db.execute(`
      CREATE TABLE IF NOT EXISTS subjects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS focus_sessions (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        title TEXT NOT NULL,
        planned_duration INTEGER NOT NULL,
        actual_duration INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        status TEXT NOT NULL,
        pause_count INTEGER NOT NULL,
        pause_duration INTEGER NOT NULL,
        distraction_count INTEGER NOT NULL,
        break_count INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )
    `)

    await removeLegacyDefaultSqlSubjects()

    mode = 'sqlite'
    return mode
  } catch {
    mode = 'local'
    migrateLegacyLocalData()
    return mode
  }
}

export async function listSubjects(): Promise<Subject[]> {
  if (mode === 'sqlite' && db) return listSqlSubjects()
  return readLocal<Subject[]>(LOCAL_SUBJECTS_KEY, [])
}

export async function createSubject(input: NewSubject): Promise<Subject> {
  const subject = makeSubject(input.name, input.color)
  if (mode === 'sqlite' && db) {
    await insertSqlSubject(subject)
    return subject
  }

  const subjects = await listSubjects()
  writeLocal(LOCAL_SUBJECTS_KEY, [...subjects, subject])
  return subject
}

export async function deleteSubject(subjectId: string): Promise<void> {
  if (mode === 'sqlite' && db) {
    await db.execute('DELETE FROM subjects WHERE id = $1', [subjectId])
    return
  }

  const subjects = await listSubjects()
  writeLocal(
    LOCAL_SUBJECTS_KEY,
    subjects.filter((subject) => subject.id !== subjectId),
  )
}

export async function listSessions(): Promise<FocusSession[]> {
  if (mode === 'sqlite' && db) {
    const rows = await db.select<SessionRow[]>(
      'SELECT * FROM focus_sessions ORDER BY started_at DESC',
    )
    return rows.map(rowToSession)
  }

  return readLocal<FocusSession[]>(LOCAL_SESSIONS_KEY, []).sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  )
}

export async function saveSession(session: FocusSession): Promise<void> {
  if (mode === 'sqlite' && db) {
    await db.execute(
      `INSERT INTO focus_sessions (
        id,
        subject_id,
        title,
        planned_duration,
        actual_duration,
        started_at,
        ended_at,
        status,
        pause_count,
        pause_duration,
        distraction_count,
        break_count,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        session.id,
        session.subjectId,
        session.title,
        session.plannedDuration,
        session.actualDuration,
        session.startedAt,
        session.endedAt,
        session.status,
        session.pauseCount,
        session.pauseDuration,
        session.distractionCount,
        session.breakCount,
        session.createdAt,
      ],
    )
    return
  }

  const sessions = await listSessions()
  writeLocal(LOCAL_SESSIONS_KEY, [session, ...sessions])
}

async function listSqlSubjects() {
  if (!db) return []
  const rows = await db.select<SubjectRow[]>(
    'SELECT * FROM subjects ORDER BY created_at ASC',
  )
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
  }))
}

async function insertSqlSubject(subject: Subject) {
  if (!db) return
  await db.execute(
    'INSERT INTO subjects (id, name, color, created_at) VALUES ($1, $2, $3, $4)',
    [subject.id, subject.name, subject.color, subject.createdAt],
  )
}

async function removeLegacyDefaultSqlSubjects() {
  if (!db) return
  await db.execute(
    `DELETE FROM subjects
      WHERE name IN ($1, $2, $3, $4, $5)
      AND id NOT IN (SELECT DISTINCT subject_id FROM focus_sessions)`,
    [...LEGACY_DEFAULT_SUBJECT_NAMES],
  )
}

function migrateLegacyLocalData() {
  const currentSubjects = readLocal<Subject[] | null>(LOCAL_SUBJECTS_KEY, null)
  if (!currentSubjects) {
    const legacySubjects = readLocal<Subject[]>(LEGACY_LOCAL_SUBJECTS_KEY, [])
    writeLocal(
      LOCAL_SUBJECTS_KEY,
      legacySubjects.filter((subject) => !LEGACY_DEFAULT_SUBJECT_NAMES.has(subject.name)),
    )
  }

  const currentSessions = readLocal<FocusSession[] | null>(LOCAL_SESSIONS_KEY, null)
  if (!currentSessions) {
    writeLocal(LOCAL_SESSIONS_KEY, readLocal<FocusSession[]>(LEGACY_LOCAL_SESSIONS_KEY, []))
  }
}

function makeSubject(name: string, color: string): Subject {
  return {
    id: crypto.randomUUID(),
    name,
    color,
    createdAt: new Date().toISOString(),
  }
}

function readLocal<T>(key: string, fallback: T): T {
  const raw = window.localStorage.getItem(key)
  if (!raw) return fallback

  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeLocal<T>(key: string, value: T) {
  window.localStorage.setItem(key, JSON.stringify(value))
}

function rowToSession(row: SessionRow): FocusSession {
  return {
    id: row.id,
    subjectId: row.subject_id,
    title: row.title,
    plannedDuration: row.planned_duration,
    actualDuration: row.actual_duration,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
    pauseCount: row.pause_count,
    pauseDuration: row.pause_duration,
    distractionCount: row.distraction_count,
    breakCount: row.break_count,
    createdAt: row.created_at,
  }
}

type SubjectRow = {
  id: string
  name: string
  color: string
  created_at: string
}

type SessionRow = {
  id: string
  subject_id: string
  title: string
  planned_duration: number
  actual_duration: number
  started_at: string
  ended_at: string
  status: FocusSession['status']
  pause_count: number
  pause_duration: number
  distraction_count: number
  break_count: number
  created_at: string
}
