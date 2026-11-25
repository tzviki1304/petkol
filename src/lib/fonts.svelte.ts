import { allFonts, putFont, deleteFont } from './db'
import { toB64 } from './crypto'

export interface FontInfo {
  family: string // CSS family name
  label: string // shown to the user
  kind: 'sans' | 'serif' | 'display' | 'custom' | 'system'
}

const files = import.meta.glob('/node_modules/@fontsource/*/files/*-{hebrew,latin}-{400,700}-normal.woff2', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

const BUNDLED: (FontInfo & { pkg: string })[] = [
  { pkg: 'assistant', family: 'Assistant', label: 'אסיסטנט', kind: 'sans' },
  { pkg: 'heebo', family: 'Heebo', label: 'היבו', kind: 'sans' },
  { pkg: 'rubik', family: 'Rubik', label: 'רוביק', kind: 'sans' },
  { pkg: 'alef', family: 'Alef', label: 'אלף', kind: 'sans' },
  { pkg: 'miriam-libre', family: 'Miriam Libre', label: 'מרים', kind: 'sans' },
  { pkg: 'frank-ruhl-libre', family: 'Frank Ruhl Libre', label: 'פרנק רוהל', kind: 'serif' },
  { pkg: 'david-libre', family: 'David Libre', label: 'דוד', kind: 'serif' },
  { pkg: 'noto-serif-hebrew', family: 'Noto Serif Hebrew', label: 'נוטו סריף', kind: 'serif' },
  { pkg: 'suez-one', family: 'Suez One', label: 'סואץ (כותרות)', kind: 'display' },
]

const RANGES = {
  hebrew: 'U+0307-0308, U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F',
  latin:
    'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
}

interface FaceSrc { family: string; weight: number; subset: 'hebrew' | 'latin'; url: string }
const faces: FaceSrc[] = []
for (const f of BUNDLED) {
  for (const subset of ['hebrew', 'latin'] as const) {
    for (const weight of [400, 700]) {
      const url = files[`/node_modules/@fontsource/${f.pkg}/files/${f.pkg}-${subset}-${weight}-normal.woff2`]
      if (url) faces.push({ family: f.family, weight, subset, url })
    }
  }
}

export const fontState = $state({ custom: [] as FontInfo[] })

export function allFontChoices(): FontInfo[] {
  return [
    ...BUNDLED.map(({ family, label, kind }) => ({ family, label, kind })),
    ...fontState.custom,
    { family: 'system-ui', label: 'גופן המכשיר', kind: 'system' as const },
  ]
}

export function fontLabel(family: string): string {
  return allFontChoices().find((f) => f.family === family)?.label ?? family
}

export function fontStack(family: string): string {
  if (family === 'system-ui') return 'system-ui, sans-serif'
  return `"${family}", "Assistant", system-ui, sans-serif`
}

/** Registers the bundled @font-face rules (lazy: the browser only downloads what is used). */
export function installBundledFonts() {
  const css = faces
    .map(
      (f) =>
        `@font-face{font-family:"${f.family}";font-style:normal;font-weight:${f.weight};font-display:swap;src:url(${f.url}) format("woff2");unicode-range:${RANGES[f.subset]};}`,
    )
    .join('\n')
  const style = document.createElement('style')
  style.id = 'petkol-fonts'
  style.textContent = css
  document.head.appendChild(style)
}

const customData = new Map<string, ArrayBuffer>()

async function registerCustom(name: string, data: ArrayBuffer) {
  const face = new FontFace(name, data.slice(0))
  await face.load()
  document.fonts.add(face)
  customData.set(name, data)
}

export async function loadCustomFonts() {
  const list = await allFonts()
  const ok: FontInfo[] = []
  for (const f of list) {
    try {
      await registerCustom(f.name, f.data)
      ok.push({ family: f.name, label: f.name, kind: 'custom' })
    } catch (e) {
      console.warn('font failed', f.name, e)
    }
  }
  fontState.custom = ok
}

export async function addCustomFont(name: string, data: ArrayBuffer) {
  const clean = name.replace(/\.(ttf|otf|woff2?|ttc)$/i, '').replace(/["\\]/g, '').trim() || 'גופן'
  await registerCustom(clean, data) // throws if the file is not a usable font
  await putFont({ name: clean, data, added: Date.now() })
  if (!fontState.custom.some((f) => f.family === clean)) {
    fontState.custom = [...fontState.custom, { family: clean, label: clean, kind: 'custom' }]
  }
  return clean
}

export async function removeCustomFont(name: string) {
  await deleteFont(name)
  customData.delete(name)
  fontState.custom = fontState.custom.filter((f) => f.family !== name)
}

/** @font-face rules with the font data inlined, for PDF export (the PDF renderer cannot reach app files). */
export async function embeddedFontCss(families: string[]): Promise<string> {
  const wanted = new Set(families)
  wanted.add('Assistant')
  const out: string[] = []
  for (const f of faces) {
    if (!wanted.has(f.family)) continue
    try {
      const buf = await (await fetch(f.url)).arrayBuffer()
      out.push(
        `@font-face{font-family:"${f.family}";font-weight:${f.weight};src:url(data:font/woff2;base64,${toB64(buf)}) format("woff2");unicode-range:${RANGES[f.subset]};}`,
      )
    } catch {}
  }
  for (const name of wanted) {
    const data = customData.get(name)
    if (data) out.push(`@font-face{font-family:"${name}";src:url(data:font/ttf;base64,${toB64(data)});}`)
  }
  return out.join('\n')
}
