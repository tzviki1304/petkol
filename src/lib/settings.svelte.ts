export type Theme = 'paper' | 'eink' | 'sepia' | 'dark'
export type EngineId = 'ozen' | 'ivrit'
export type Accent = 'clay' | 'blue' | 'green' | 'plum' | 'graphite'

export interface Settings {
  // Appearance
  theme: Theme
  accent: Accent
  uiFont: string
  uiScale: number // 0.9 – 1.4
  animations: boolean
  density: 'comfortable' | 'compact'
  previewLines: 0 | 1 | 2 | 3
  showDates: boolean
  sortBy: 'updated' | 'created' | 'title'
  foldersFirst: boolean
  // Editor
  editorFont: string
  editorSize: number // px
  lineHeight: number
  pageMargin: 'narrow' | 'normal' | 'wide'
  toolbarPosition: 'top' | 'bottom'
  defaultPaper: 'plain' | 'lined' | 'grid' | 'dots'
  showWordCount: boolean
  showTitle: boolean
  spellcheck: boolean
  // Dictation
  engine: EngineId
  processing: 'auto' | 'fast' | 'safe' // fast = native ONNX Runtime, safe = WASM inside the app
  calm: boolean // fewer threads + rests between pieces, kinder to weak devices
  tidyAfter: boolean // tidy the text of a long recording when it is done
  insertAt: 'cursor' | 'end'
  silenceMs: number // pause that closes a phrase
  autoStopSec: number // 0 = never
  sensitivity: 'quiet' | 'normal' | 'noisy'
  voiceCommands: boolean
  keepScreenOn: boolean
  replacements: { from: string; to: string }[]
  vocabulary: string // hint words, for the precise engine
  // Privacy
  autoLockMin: number // -1 never, 0 immediately when leaving the app
  confirmDelete: boolean
  // Updates
  autoCheckUpdates: boolean
}

export const defaults: Settings = {
  theme: 'paper',
  accent: 'clay',
  uiFont: 'Assistant',
  uiScale: 1,
  animations: false,
  density: 'comfortable',
  previewLines: 2,
  showDates: true,
  sortBy: 'updated',
  foldersFirst: true,
  editorFont: 'Assistant',
  editorSize: 19,
  lineHeight: 1.7,
  pageMargin: 'normal',
  toolbarPosition: 'top',
  defaultPaper: 'plain',
  showWordCount: true,
  showTitle: true,
  spellcheck: false,
  engine: 'ozen',
  processing: 'auto',
  calm: true,
  tidyAfter: true,
  insertAt: 'cursor',
  silenceMs: 900,
  autoStopSec: 0,
  sensitivity: 'normal',
  voiceCommands: false,
  keepScreenOn: true,
  replacements: [],
  vocabulary: '',
  autoLockMin: 5,
  confirmDelete: true,
  autoCheckUpdates: true,
}

const KEY = 'petkol.settings'

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...defaults, ...JSON.parse(raw) }
  } catch {}
  return { ...defaults }
}

export const settings: Settings = $state(load())

export function saveSettings() {
  localStorage.setItem(KEY, JSON.stringify($state.snapshot(settings)))
}

export function resetSettings() {
  Object.assign(settings, defaults, { replacements: [] })
  saveSettings()
}
