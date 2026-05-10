import { useEffect, useMemo, useState } from 'react'
import { Check, Pause, Play, Send, Settings, Square } from 'lucide-react'
import './App.css'
import { createSubject, initStore, listSessions, listSubjects, saveSession } from './storage'
import type { FocusSession, SessionStatus, Subject } from './types'
import { resolveFocusCommandStream, type AiConfig } from './ai'

const DEFAULT_MINUTES = 25
const AI_CONFIG_KEY = 'urchin.aiConfig'
const SUBJECT_COLORS = ['#111827', '#2563eb', '#0f766e', '#ca8a04', '#7c3aed', '#dc2626']

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

type ChatMessage = {
  id: string
  role: 'assistant' | 'user'
  content: string
}

function App() {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [sessions, setSessions] = useState<FocusSession[]>([])
  const [activeFocus, setActiveFocus] = useState<ActiveFocus | null>(null)
  const [manualSubject, setManualSubject] = useState('')
  const [manualTitle, setManualTitle] = useState('今天的专注')
  const [manualMinutes, setManualMinutes] = useState(DEFAULT_MINUTES)
  const [chatInput, setChatInput] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [storageMode, setStorageMode] = useState('初始化中')
  const [aiConfig, setAiConfig] = useState<AiConfig>(() => readAiConfig())
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '告诉我你想学什么，比如“复习高数 40 分钟”。我会直接帮你开始专注。',
    },
  ])

  useEffect(() => {
    let mounted = true

    async function load() {
      const mode = await initStore()
      const [loadedSubjects, loadedSessions] = await Promise.all([listSubjects(), listSessions()])

      if (!mounted) return
      setStorageMode(mode === 'sqlite' ? 'SQLite' : 'LocalStorage')
      setSubjects(loadedSubjects)
      setSessions(loadedSessions)
      setManualSubject(loadedSubjects[0]?.name ?? '')
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

  useEffect(() => {
    window.localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(aiConfig))
  }, [aiConfig])

  const activeElapsed = useMemo(() => {
    if (!activeFocus) return 0
    const livePause = activeFocus.pausedAt ? now - activeFocus.pausedAt : 0
    return Math.max(0, now - activeFocus.startedAt - activeFocus.pauseDuration - livePause)
  }, [activeFocus, now])

  const activeSubject = subjects.find((subject) => subject.id === activeFocus?.subjectId)
  const todayTotal = useMemo(() => getTodayTotal(sessions), [sessions])
  const stats = useMemo(() => makeStats(sessions), [sessions])

  async function refreshSessions() {
    setSessions(await listSessions())
  }

  function appendMessage(role: ChatMessage['role'], content: string) {
    const id = crypto.randomUUID()
    setMessages((current) => [...current, { id, role, content }])
    return id
  }

  function updateMessage(messageId: string, content: string) {
    setMessages((current) =>
      current.map((message) => (message.id === messageId ? { ...message, content } : message)),
    )
  }

  async function handleChatSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = chatInput.trim()
    if (!input || isThinking) return

    setChatInput('')
    appendMessage('user', input)
    const assistantMessageId = appendMessage('assistant', '正在理解...')
    setIsThinking(true)

    try {
      const command = await resolveFocusCommandStream(input, subjects, aiConfig, (text) => {
        updateMessage(assistantMessageId, text || '正在理解...')
      })
      if (command.intent !== 'start_focus') {
        updateMessage(assistantMessageId, command.reply)
        return
      }

      if (activeFocus) {
        updateMessage(assistantMessageId, '现在已经有一个专注在进行中。先完成或放弃它，再开始新的任务。')
        return
      }

      const subject = await ensureSubject(command.subjectName)
      startFocus(subject.id, command.title, command.minutes)
      updateMessage(assistantMessageId, command.reply)
    } catch {
      updateMessage(assistantMessageId, '这次没有解析成功。你可以试试“学习英语 25 分钟”这种格式。')
    } finally {
      setIsThinking(false)
    }
  }

  async function handleManualStart(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (activeFocus) return

    const subjectName = manualSubject.trim() || '专注'
    const subject = await ensureSubject(subjectName)
    startFocus(subject.id, manualTitle.trim() || subjectName, manualMinutes)
  }

  async function ensureSubject(name: string) {
    const subjectName = name.trim() || '专注'
    const existing = subjects.find(
      (subject) => subject.name.toLowerCase() === subjectName.toLowerCase(),
    )
    if (existing) return existing

    const created = await createSubject({
      name: subjectName,
      color: SUBJECT_COLORS[subjects.length % SUBJECT_COLORS.length],
    })
    const nextSubjects = await listSubjects()
    setSubjects(nextSubjects)
    setManualSubject(created.name)
    return created
  }

  function startFocus(subjectId: string, title: string, minutes: number) {
    setActiveFocus({
      id: crypto.randomUUID(),
      subjectId,
      title,
      plannedDuration: clampMinutes(minutes) * 60 * 1000,
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
      return { ...current, pauseCount: current.pauseCount + 1, pausedAt: Date.now() }
    })
  }

  async function finishFocus(status: SessionStatus) {
    if (!activeFocus) return

    const endedAt = Date.now()
    const livePause = activeFocus.pausedAt ? endedAt - activeFocus.pausedAt : 0
    const pauseDuration = activeFocus.pauseDuration + livePause
    const actualDuration = Math.max(0, endedAt - activeFocus.startedAt - pauseDuration)

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

    appendMessage('assistant', `${status === 'completed' ? '已完成' : '已放弃'}：${activeFocus.title}`)
    setActiveFocus(null)
    await refreshSessions()
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <span>Urchin</span>
        <span>{storageMode}</span>
      </header>

      <section className="ai-stage" aria-label="AI 专注助手">
        <div className="messages">
          {messages.slice(1).map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              {message.content}
            </article>
          ))}
        </div>

        <div className="hero-prompt">
          <h1>{activeFocus ? activeFocus.title : '今天有什么计划？'}</h1>
          {activeFocus && (
            <p>
              {activeSubject?.name ?? '专注'} · {formatClock(activeElapsed)}
            </p>
          )}
        </div>

        <div className="composer-row">
          <form className="chat-input" onSubmit={handleChatSubmit}>
            <input
              aria-label="自然语言专注指令"
              placeholder="有问题，尽管问。也可以说：深度学习 30 分钟"
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
            />
            <button aria-label="发送" disabled={isThinking || !chatInput.trim()} type="submit">
              <Send size={18} />
            </button>
          </form>

          <aside className="focus-dock" aria-label="专注功能">
            <section className="timer-card">
              <span className="status-dot" data-active={Boolean(activeFocus)} />
              <strong>{formatClock(activeElapsed)}</strong>
              <progress
                value={activeFocus ? Math.min(activeElapsed / activeFocus.plannedDuration, 1) : 0}
                max={1}
              />
              <small>
                {activeFocus
                  ? activeFocus.pausedAt
                    ? '已暂停'
                    : activeSubject?.name ?? '专注中'
                  : `今日 ${formatDuration(todayTotal)}`}
              </small>
            </section>

            <section className="stats-card">
              <div className="stats-grid">
                <div>
                  <span>今日</span>
                  <strong>{formatDuration(stats.todayTotal)}</strong>
                </div>
                <div>
                  <span>完成</span>
                  <strong>{stats.completedCount}</strong>
                </div>
                <div>
                  <span>最长</span>
                  <strong>{formatDuration(stats.longestSession)}</strong>
                </div>
              </div>
              <div className="week-bars" aria-label="本周专注统计">
                {stats.weekDays.map((day) => (
                  <div key={day.label}>
                    <i style={{ height: `${Math.max(6, day.percent)}%` }} />
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>

        <div className="quick-actions">
          {activeFocus ? (
            <>
              <button onClick={togglePause} type="button">
                {activeFocus.pausedAt ? <Play size={16} /> : <Pause size={16} />}
                {activeFocus.pausedAt ? '继续' : '暂停'}
              </button>
              <button onClick={() => finishFocus('completed')} type="button">
                <Check size={16} />
                完成
              </button>
              <button onClick={() => finishFocus('abandoned')} type="button">
                <Square size={16} />
                放弃
              </button>
            </>
          ) : (
            <details className="manual-popover">
              <summary>
                <Play size={16} />
                手动开始
              </summary>
              <form className="manual-form" onSubmit={handleManualStart}>
                <input value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} />
                <input
                  list="subject-options"
                  value={manualSubject}
                  onChange={(event) => setManualSubject(event.target.value)}
                />
                <datalist id="subject-options">
                  {subjects.map((subject) => (
                    <option key={subject.id} value={subject.name} />
                  ))}
                </datalist>
                <input
                  min={5}
                  max={180}
                  step={5}
                  type="number"
                  value={manualMinutes}
                  onChange={(event) => setManualMinutes(Number(event.target.value))}
                />
                <button type="submit">开始</button>
              </form>
            </details>
          )}

          <details className="settings-panel">
            <summary>
              <Settings size={16} />
              AI 设置
            </summary>
            <div className="settings-fields">
              <input
                aria-label="Endpoint"
                value={aiConfig.endpoint}
                onChange={(event) => setAiConfig({ ...aiConfig, endpoint: event.target.value })}
              />
              <input
                aria-label="Model"
                value={aiConfig.model}
                onChange={(event) => setAiConfig({ ...aiConfig, model: event.target.value })}
              />
              <input
                aria-label="API Key"
                type="password"
                value={aiConfig.apiKey}
                onChange={(event) => setAiConfig({ ...aiConfig, apiKey: event.target.value })}
              />
            </div>
          </details>
        </div>
      </section>
    </main>
  )
}

function readAiConfig(): AiConfig {
  const fallback = {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    apiKey: '',
    model: 'gpt-4o-mini',
  }
  const raw = window.localStorage.getItem(AI_CONFIG_KEY)
  if (!raw) return fallback

  try {
    return { ...fallback, ...(JSON.parse(raw) as Partial<AiConfig>) }
  } catch {
    return fallback
  }
}

function getTodayTotal(sessions: FocusSession[]) {
  const start = startOfDay(new Date())
  const end = addDays(start, 1)
  return sessions
    .filter((session) => {
      const date = new Date(session.startedAt)
      return date >= start && date < end
    })
    .reduce((sum, session) => sum + session.actualDuration, 0)
}

function makeStats(sessions: FocusSession[]) {
  const now = new Date()
  const todayStart = startOfDay(now)
  const todayEnd = addDays(todayStart, 1)
  const weekStart = startOfWeek(now)
  const todaySessions = sessions.filter((session) => {
    const date = new Date(session.startedAt)
    return date >= todayStart && date < todayEnd
  })

  const weekDurations = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index)
    const next = addDays(date, 1)
    return sessions
      .filter((session) => {
        const sessionDate = new Date(session.startedAt)
        return sessionDate >= date && sessionDate < next
      })
      .reduce((sum, session) => sum + session.actualDuration, 0)
  })
  const maxWeekDuration = Math.max(...weekDurations, 1)

  return {
    todayTotal: todaySessions.reduce((sum, session) => sum + session.actualDuration, 0),
    completedCount: todaySessions.filter((session) => session.status === 'completed').length,
    longestSession: todaySessions.reduce(
      (max, session) => Math.max(max, session.actualDuration),
      0,
    ),
    weekDays: weekDurations.map((duration, index) => ({
      label: ['一', '二', '三', '四', '五', '六', '日'][index],
      duration,
      percent: (duration / maxWeekDuration) * 100,
    })),
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

function clampMinutes(minutes: number) {
  return Math.min(180, Math.max(5, Math.round(minutes || DEFAULT_MINUTES)))
}

function formatClock(ms: number) {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((part) => part.toString().padStart(2, '0')).join(':')
}

function formatDuration(ms: number) {
  const totalMinutes = Math.floor(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}min`
  return `${hours}h${minutes.toString().padStart(2, '0')}min`
}

export default App
