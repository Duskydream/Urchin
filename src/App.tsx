import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  BarChart3,
  BookOpen,
  Check,
  Palette,
  Pause,
  Play,
  Plus,
  Square,
  TimerReset,
  Trash2,
} from 'lucide-react'
import './App.css'
import {
  createSubject,
  deleteSubject,
  initStore,
  listSessions,
  listSubjects,
  saveSession,
} from './storage'
import type { FocusSession, SessionStatus, Subject } from './types'

const DEFAULT_MINUTES = 25
const THEME_KEY = 'learning-tool.theme'
const THEMES = [
  { id: 'study-room', name: '清爽自习室' },
  { id: 'costudy', name: 'CoStudy 暖色' },
  { id: 'night', name: '深色夜读' },
] as const

type ThemeId = (typeof THEMES)[number]['id']

const REPORT_DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

type ActiveFocus = {
  id: string
  subjectId: string
  title: string
  plannedDuration: number
  startedAt: number
  pausedAt?: number
  pauseCount: number
  pauseDuration: number
}

function App() {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [sessions, setSessions] = useState<FocusSession[]>([])
  const [activeFocus, setActiveFocus] = useState<ActiveFocus | null>(null)
  const [selectedSubjectId, setSelectedSubjectId] = useState('')
  const [focusTitle, setFocusTitle] = useState('今天的专注')
  const [plannedMinutes, setPlannedMinutes] = useState(DEFAULT_MINUTES)
  const [newSubjectName, setNewSubjectName] = useState('')
  const [newSubjectColor, setNewSubjectColor] = useState('#cf6a32')
  const [now, setNow] = useState(() => Date.now())
  const [storageMode, setStorageMode] = useState('初始化中')
  const [theme, setTheme] = useState<ThemeId>(() => readTheme())

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    let mounted = true

    async function load() {
      const mode = await initStore()
      const [loadedSubjects, loadedSessions] = await Promise.all([
        listSubjects(),
        listSessions(),
      ])

      if (!mounted) return
      setStorageMode(mode === 'sqlite' ? 'SQLite' : 'LocalStorage')
      setSubjects(loadedSubjects)
      setSessions(loadedSessions)
      setSelectedSubjectId(loadedSubjects[0]?.id ?? '')
    }

    load()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const activeElapsed = useMemo(() => {
    if (!activeFocus) return 0
    const livePause = activeFocus.pausedAt ? now - activeFocus.pausedAt : 0
    return Math.max(
      0,
      now - activeFocus.startedAt - activeFocus.pauseDuration - livePause,
    )
  }, [activeFocus, now])

  const todayStats = useMemo(() => makeStats(sessions, subjects, 'today'), [
    sessions,
    subjects,
  ])
  const weekStats = useMemo(() => makeStats(sessions, subjects, 'week'), [
    sessions,
    subjects,
  ])

  const selectedSubject = subjects.find((subject) => subject.id === selectedSubjectId)

  async function refreshSessions() {
    setSessions(await listSessions())
  }

  async function handleAddSubject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = newSubjectName.trim()
    if (!name) return

    const subject = await createSubject({
      name,
      color: newSubjectColor,
    })
    const nextSubjects = await listSubjects()
    setSubjects(nextSubjects)
    setSelectedSubjectId(subject.id)
    setNewSubjectName('')
  }

  async function handleDeleteSubject(subjectId: string) {
    await deleteSubject(subjectId)
    const nextSubjects = await listSubjects()
    setSubjects(nextSubjects)
    if (selectedSubjectId === subjectId) {
      setSelectedSubjectId(nextSubjects[0]?.id ?? '')
    }
  }

  function startFocus() {
    if (!selectedSubjectId || activeFocus) return
    setActiveFocus({
      id: crypto.randomUUID(),
      subjectId: selectedSubjectId,
      title: focusTitle.trim() || '未命名专注',
      plannedDuration: plannedMinutes * 60 * 1000,
      startedAt: Date.now(),
      pauseCount: 0,
      pauseDuration: 0,
    })
  }

  function togglePause() {
    setActiveFocus((current) => {
      if (!current) return null
      if (current.pausedAt) {
        return {
          ...current,
          pauseDuration: current.pauseDuration + Date.now() - current.pausedAt,
          pausedAt: undefined,
        }
      }
      return {
        ...current,
        pauseCount: current.pauseCount + 1,
        pausedAt: Date.now(),
      }
    })
  }

  async function finishFocus(status: SessionStatus) {
    if (!activeFocus) return

    const endedAt = Date.now()
    const livePause = activeFocus.pausedAt ? endedAt - activeFocus.pausedAt : 0
    const pauseDuration = activeFocus.pauseDuration + livePause
    const actualDuration = Math.max(
      0,
      endedAt - activeFocus.startedAt - pauseDuration,
    )

    await saveSession({
      id: activeFocus.id,
      subjectId: activeFocus.subjectId,
      title: activeFocus.title,
      plannedDuration: activeFocus.plannedDuration,
      actualDuration,
      startedAt: new Date(activeFocus.startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      status,
      pauseCount: activeFocus.pauseCount,
      pauseDuration,
      distractionCount: status === 'abandoned' ? 1 : 0,
      breakCount: 0,
      createdAt: new Date().toISOString(),
    })

    setActiveFocus(null)
    await refreshSessions()
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">CoStudy-like MVP</p>
          <h1>学习专注台</h1>
        </div>
        <nav aria-label="主功能">
          <a href="#focus">
            <TimerReset size={18} />
            专注
          </a>
          <a href="#stats">
            <BarChart3 size={18} />
            统计
          </a>
          <a href="#subjects">
            <BookOpen size={18} />
            科目
          </a>
        </nav>
        <label className="theme-picker">
          <span>
            <Palette size={16} />
            主题
          </span>
          <select value={theme} onChange={(event) => setTheme(event.target.value as ThemeId)}>
            {THEMES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <div className="storage-pill">存储：{storageMode}</div>
      </aside>

      <section className="content">
        <section className="dashboard-band">
          <div>
            <p className="eyebrow">今日总专注</p>
            <strong>{formatDuration(todayStats.totalDuration)}</strong>
          </div>
          <div>
            <p className="eyebrow">本周累计</p>
            <strong>{formatDuration(weekStats.totalDuration)}</strong>
          </div>
          <div>
            <p className="eyebrow">完成次数</p>
            <strong>{todayStats.completedCount}</strong>
          </div>
          <div>
            <p className="eyebrow">最长专注</p>
            <strong>{formatDuration(todayStats.longestSession)}</strong>
          </div>
        </section>

        <section id="focus" className="focus-layout">
          <div className="focus-panel">
            <div className="section-heading">
              <p className="eyebrow">Focus Mode</p>
              <h2>专注模式</h2>
            </div>

            <div className="timer-face">
              <span>{selectedSubject?.name ?? '选择科目'}</span>
              <strong>{formatClock(activeElapsed)}</strong>
              <progress
                value={activeFocus ? Math.min(activeElapsed / activeFocus.plannedDuration, 1) : 0}
                max={1}
              />
            </div>

            <div className="control-row">
              {!activeFocus ? (
                <button
                  className="primary-action"
                  disabled={!selectedSubjectId}
                  onClick={startFocus}
                  type="button"
                >
                  <Play size={18} />
                  {selectedSubjectId ? '开始专注' : '请先添加科目'}
                </button>
              ) : (
                <>
                  <button onClick={togglePause} type="button">
                    {activeFocus.pausedAt ? <Play size={18} /> : <Pause size={18} />}
                    {activeFocus.pausedAt ? '继续' : '暂停'}
                  </button>
                  <button onClick={() => finishFocus('completed')} type="button">
                    <Check size={18} />
                    完成
                  </button>
                  <button className="danger-action" onClick={() => finishFocus('abandoned')} type="button">
                    <Square size={18} />
                    放弃
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="setup-panel">
            <label>
              专注标题
              <input
                disabled={Boolean(activeFocus)}
                value={focusTitle}
                onChange={(event) => setFocusTitle(event.target.value)}
              />
            </label>
            <label>
              科目
              <select
                disabled={Boolean(activeFocus)}
                value={selectedSubjectId}
                onChange={(event) => setSelectedSubjectId(event.target.value)}
              >
                {subjects.length === 0 && <option value="">暂无科目</option>}
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              计划时长（分钟）
              <input
                disabled={Boolean(activeFocus)}
                min={5}
                max={180}
                step={5}
                type="number"
                value={plannedMinutes}
                onChange={(event) => setPlannedMinutes(Number(event.target.value))}
              />
            </label>
          </div>
        </section>

        <section id="stats" className="stats-grid">
          <div className="chart-panel">
            <div className="section-heading">
              <p className="eyebrow">Today</p>
              <h2>科目占比</h2>
            </div>
            <div className="donut-wrap">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={todayStats.subjectData}
                    dataKey="duration"
                    innerRadius={72}
                    outerRadius={116}
                    paddingAngle={1}
                  >
                    {todayStats.subjectData.map((entry) => (
                      <Cell key={entry.subjectId} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatDuration(Number(value ?? 0))} />
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-center">
                <span>全部</span>
                <strong>{formatDuration(todayStats.totalDuration)}</strong>
              </div>
            </div>
            <div className="legend-list">
              {todayStats.subjectData.map((item) => (
                <span key={item.subjectId}>
                  <i style={{ background: item.color }} />
                  {item.name} {item.percent.toFixed(1)}%
                </span>
              ))}
            </div>
          </div>

          <div className="chart-panel">
            <div className="section-heading">
              <p className="eyebrow">Week</p>
              <h2>本周趋势</h2>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={weekStats.dailyData}>
                <XAxis dataKey="label" stroke="var(--chart-axis)" />
                <YAxis
                  stroke="var(--chart-axis)"
                  tickFormatter={(value) => `${Math.round(Number(value) / 3600000)}h`}
                />
                <Tooltip formatter={(value) => formatDuration(Number(value ?? 0))} />
                <Bar dataKey="duration" fill="var(--primary)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="report-panel">
          <div className="report-card">
            <div className="report-title">
              <strong>今日学习报告</strong>
              <span>Urchin Focus Report</span>
            </div>
            <div className="date-badge">{REPORT_DATE_FORMATTER.format(new Date())}</div>
            <p className="report-total">全部 专注时长 {formatDuration(todayStats.totalDuration)}</p>
            <div className="report-metrics">
              <span>自习次数 x{todayStats.totalCount}</span>
              <span>成功专注 x{todayStats.completedCount}</span>
              <span>暂停次数 x{todayStats.pauseCount}</span>
              <span>放弃次数 x{todayStats.abandonedCount}</span>
            </div>
          </div>
          <div className="session-list">
            <h2>最近记录</h2>
            {sessions.slice(0, 6).map((session) => {
              const subject = subjects.find((item) => item.id === session.subjectId)
              return (
                <article key={session.id}>
                  <i style={{ background: subject?.color ?? 'var(--muted)' }} />
                  <div>
                    <strong>{session.title}</strong>
                    <span>{subject?.name ?? '未知科目'} · {formatDuration(session.actualDuration)}</span>
                  </div>
                  <em>{session.status === 'completed' ? '完成' : '放弃'}</em>
                </article>
              )
            })}
          </div>
        </section>

        <section id="subjects" className="subjects-panel">
          <div className="section-heading">
            <p className="eyebrow">Subjects</p>
            <h2>科目管理</h2>
          </div>
          <form onSubmit={handleAddSubject}>
            <input
              aria-label="科目名称"
              placeholder="新增科目"
              value={newSubjectName}
              onChange={(event) => setNewSubjectName(event.target.value)}
            />
            <input
              aria-label="科目颜色"
              type="color"
              value={newSubjectColor}
              onChange={(event) => setNewSubjectColor(event.target.value)}
            />
            <button type="submit">
              <Plus size={18} />
              添加
            </button>
          </form>
          <div className="subject-list">
            {subjects.map((subject) => (
              <article key={subject.id}>
                <i style={{ background: subject.color }} />
                <strong>{subject.name}</strong>
                <button
                  aria-label={`删除 ${subject.name}`}
                  onClick={() => handleDeleteSubject(subject.id)}
                  type="button"
                >
                  <Trash2 size={16} />
                </button>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  )
}

function readTheme(): ThemeId {
  const stored = window.localStorage.getItem(THEME_KEY)
  return THEMES.some((item) => item.id === stored) ? (stored as ThemeId) : 'study-room'
}

function makeStats(sessions: FocusSession[], subjects: Subject[], range: 'today' | 'week') {
  const now = new Date()
  const start = range === 'today' ? startOfDay(now) : startOfWeek(now)
  const end = range === 'today' ? addDays(start, 1) : addDays(start, 7)
  const filtered = sessions.filter((session) => {
    const date = new Date(session.startedAt)
    return date >= start && date < end
  })

  const totalDuration = filtered.reduce((sum, session) => sum + session.actualDuration, 0)
  const bySubject = subjects
    .map((subject) => {
      const duration = filtered
        .filter((session) => session.subjectId === subject.id)
        .reduce((sum, session) => sum + session.actualDuration, 0)
      return {
        subjectId: subject.id,
        name: subject.name,
        color: subject.color,
        duration,
        percent: totalDuration > 0 ? (duration / totalDuration) * 100 : 0,
      }
    })
    .filter((item) => item.duration > 0)

  const dailyData = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(startOfWeek(now), index)
    const next = addDays(date, 1)
    const duration = sessions
      .filter((session) => {
        const sessionDate = new Date(session.startedAt)
        return sessionDate >= date && sessionDate < next
      })
      .reduce((sum, session) => sum + session.actualDuration, 0)
    return {
      label: ['一', '二', '三', '四', '五', '六', '日'][index],
      duration,
    }
  })

  return {
    totalDuration,
    totalCount: filtered.length,
    completedCount: filtered.filter((session) => session.status === 'completed').length,
    abandonedCount: filtered.filter((session) => session.status === 'abandoned').length,
    pauseCount: filtered.reduce((sum, session) => sum + session.pauseCount, 0),
    longestSession: filtered.reduce(
      (max, session) => Math.max(max, session.actualDuration),
      0,
    ),
    subjectData: bySubject,
    dailyData,
  }
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function startOfWeek(date: Date) {
  const start = startOfDay(date)
  const day = start.getDay() || 7
  start.setDate(start.getDate() - day + 1)
  return start
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function formatClock(ms: number) {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds]
    .map((part) => part.toString().padStart(2, '0'))
    .join(':')
}

function formatDuration(ms: number) {
  const totalMinutes = Math.floor(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}min`
  return `${hours}h${minutes.toString().padStart(2, '0')}min`
}

export default App
