import type { Subject } from './types'

export type AiConfig = {
  endpoint: string
  apiKey: string
  model: string
}

export type FocusCommand = {
  intent: 'start_focus' | 'none'
  title: string
  subjectName: string
  minutes: number
  reply: string
}

const DEFAULT_MINUTES = 25

export async function resolveFocusCommandStream(
  input: string,
  subjects: Subject[],
  config: AiConfig,
  onText: (text: string) => void,
): Promise<FocusCommand> {
  if (config.apiKey.trim()) {
    try {
      return await resolveWithAiStream(input, subjects, config, onText)
    } catch {
      return streamRules(input, subjects, onText)
    }
  }

  return streamRules(input, subjects, onText)
}

async function resolveWithAiStream(
  input: string,
  subjects: Subject[],
  config: AiConfig,
  onText: (text: string) => void,
): Promise<FocusCommand> {
  const response = await fetch(config.endpoint.trim(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model.trim() || 'gpt-4o-mini',
      temperature: 0,
      stream: true,
      messages: [
        {
          role: 'system',
          content:
            '你是学习专注工具里的助手。先用一句简短中文自然回复用户，然后另起一行输出 <command>{JSON}</command>。不要 markdown。JSON 结构为 {"intent":"start_focus"|"none","title":"string","subjectName":"string","minutes":number,"reply":"string"}。当用户想开始学习、复习、刷题、阅读、背单词、写作业时 intent=start_focus。minutes 必须是 5 到 180 的整数，未说明时用 25。subjectName 优先从已有科目中选择，也可以从用户文本中提取新科目。',
        },
        {
          role: 'user',
          content: JSON.stringify({
            input,
            existingSubjects: subjects.map((subject) => subject.name),
          }),
        },
      ],
    }),
  })

  if (!response.ok || !response.body) throw new Error('AI request failed')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let raw = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value, { stream: true })
    for (const token of parseStreamTokens(chunk)) {
      raw += token
      onText(extractVisibleReply(raw))
    }
  }

  const command = extractCommand(raw)
  return normalizeCommand(command, input, subjects, extractVisibleReply(raw))
}

async function streamRules(
  input: string,
  subjects: Subject[],
  onText: (text: string) => void,
): Promise<FocusCommand> {
  const command = resolveWithRules(input, subjects)
  let visible = ''

  for (const char of command.reply) {
    visible += char
    onText(visible)
    await delay(12)
  }

  return command
}

function parseStreamTokens(chunk: string) {
  const tokens: string[] = []

  for (const line of chunk.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue

    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') continue

    try {
      const data = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: string } }>
      }
      const content = data.choices?.[0]?.delta?.content
      if (content) tokens.push(content)
    } catch {
      // Ignore partial or provider-specific stream lines.
    }
  }

  return tokens
}

function extractVisibleReply(raw: string) {
  return raw.replace(/<command>[\s\S]*$/i, '').trim()
}

function extractCommand(raw: string): Partial<FocusCommand> {
  const match = raw.match(/<command>\s*([\s\S]*?)\s*<\/command>/i)
  if (!match) return {}

  try {
    return JSON.parse(stripJsonFence(match[1])) as Partial<FocusCommand>
  } catch {
    return {}
  }
}

function resolveWithRules(input: string, subjects: Subject[]): FocusCommand {
  const text = input.trim()
  const minutes = extractMinutes(text)
  const subject = findSubjectName(text, subjects)
  const parsedSubject = subject || extractSubjectName(text)
  const isFocusIntent =
    /(开始|专注|学习|复习|刷题|阅读|背|写作业|做题|练习|study|focus)/i.test(text) ||
    /\d+\s*(分钟|min|m|小时|h)/i.test(text)

  if (!isFocusIntent) {
    return {
      intent: 'none',
      title: '',
      subjectName: subject,
      minutes,
      reply: '我可以帮你把一句话变成专注任务，例如：学习英语 25 分钟。',
    }
  }

  const subjectName = parsedSubject || '专注'
  const title = cleanupTitle(text, subjectName)

  return {
    intent: 'start_focus',
    title,
    subjectName,
    minutes,
    reply: `好的，开始 ${subjectName} ${minutes} 分钟。`,
  }
}

function normalizeCommand(
  command: Partial<FocusCommand>,
  input: string,
  subjects: Subject[],
  visibleReply: string,
): FocusCommand {
  const fallback = resolveWithRules(input, subjects)
  const intent = command.intent === 'start_focus' ? 'start_focus' : 'none'

  if (intent === 'none') {
    return {
      ...fallback,
      intent: 'none',
      reply: command.reply?.trim() || visibleReply || fallback.reply,
    }
  }

  const subjectName = command.subjectName?.trim() || fallback.subjectName || '专注'
  return {
    intent,
    title: command.title?.trim() || fallback.title || subjectName,
    subjectName,
    minutes: clampMinutes(Number(command.minutes) || fallback.minutes),
    reply: command.reply?.trim() || visibleReply || fallback.reply,
  }
}

function extractMinutes(text: string) {
  if (/半\s*(个)?\s*小时/.test(text)) return 30

  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(小时|h)/i)
  if (hourMatch) return clampMinutes(Math.round(Number(hourMatch[1]) * 60))

  const minuteMatch = text.match(/(\d+)\s*(分钟|min|m)/i)
  if (minuteMatch) return clampMinutes(Number(minuteMatch[1]))

  return DEFAULT_MINUTES
}

function findSubjectName(text: string, subjects: Subject[]) {
  const normalized = text.toLowerCase()
  return subjects.find((subject) => normalized.includes(subject.name.toLowerCase()))?.name ?? ''
}

function extractSubjectName(text: string) {
  const normalized = normalizeInput(text)
  const afterDuration = normalized.match(
    /\d+(?:\.\d+)?\s*(?:分钟|min|mins?|m|小时|h)\s*(?:的|地)?\s*([^，。,.!！?？]+)/i,
  )
  if (afterDuration?.[1]) return cleanupSubjectName(afterDuration[1])

  const beforeDuration = normalized.match(
    /(?:开始|专注|学习|复习|刷题|阅读|背|写作业|做题|练习)?\s*([^，。,.!！?？]*?)\s*(?:半\s*(?:个)?\s*小时|\d+(?:\.\d+)?\s*(?:分钟|min|mins?|m|小时|h))/i,
  )
  if (beforeDuration?.[1]) return cleanupSubjectName(beforeDuration[1])

  return cleanupSubjectName(normalized)
}

function normalizeInput(text: string) {
  return text
    .replace(/[，。！？；：]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanupSubjectName(text: string) {
  return text
    .replace(/\d+(?:\.\d+)?\s*(分钟|min|m|小时|h)/gi, '')
    .replace(/半\s*(个)?\s*小时/g, '')
    .replace(/^(我)?(今天|现在|马上)?(想要|想|要)?(学|学习|复习|开始|专注|刷题|阅读|背|写作业|做题|练习)?/, '')
    .replace(/^(帮我|给我|我要|我想|想要|想学|要学|学一下|的|地)+/, '')
    .replace(/(一下|吧|的|地)$/g, '')
    .trim()
    .slice(0, 16)
}

function cleanupTitle(text: string, subjectName: string) {
  const title = subjectName || text.trim().replace(/\s+/g, ' ')
  if (!title) return subjectName
  return title.length > 28 ? `${title.slice(0, 28)}...` : title
}

function clampMinutes(minutes: number) {
  return Math.min(180, Math.max(5, Math.round(minutes)))
}

function stripJsonFence(content: string) {
  return content
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim()
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
