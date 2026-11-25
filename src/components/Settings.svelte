<script lang="ts">
  import { onMount } from 'svelte'
  import Icon from './Icon.svelte'
  import Sheet from './Sheet.svelte'
  import MenuItem from './MenuItem.svelte'
  import { confirmDialog, promptDialog, alertDialog } from './Dialog.svelte'
  import { settings, saveSettings, resetSettings, type Settings } from '../lib/settings.svelte'
  import { store } from '../lib/store.svelte'
  import { allFontChoices, fontStack, fontLabel, addCustomFont, removeCustomFont, fontState } from '../lib/fonts.svelte'
  import { engine, MODELS } from '../lib/speech/engine.svelte'
  import { updater, APP_VERSION } from '../lib/update.svelte'
  import { exportBackup, pickFile } from '../lib/exporter'
  import { isNative, Native } from '../lib/native'
  import { fromB64 } from '../lib/crypto'
  import type { EngineId } from '../lib/settings.svelte'

  let { section = '' }: { section?: string } = $props()

  type Opt = { v: unknown; label: string; hint?: string }
  let pick = $state<{ key: keyof Settings; title: string; opts: Opt[] } | null>(null)
  let pickOpen = $state(false)
  let sysFontsOpen = $state(false)
  let sysFonts = $state<{ name: string; file: string }[]>([])
  let dictOpen = $state(false)

  onMount(() => {
    if (section) setTimeout(() => document.getElementById('sec-' + section)?.scrollIntoView({ block: 'start' }), 60)
  })

  function set<K extends keyof Settings>(k: K, v: Settings[K]) {
    settings[k] = v
    saveSettings()
  }

  function choose(key: keyof Settings, title: string, opts: Opt[]) {
    pick = { key, title, opts }
    pickOpen = true
  }

  function label(key: keyof Settings, opts: Opt[]) {
    return opts.find((o) => o.v === settings[key])?.label ?? String(settings[key])
  }

  const THEMES: Opt[] = [
    { v: 'paper', label: 'קרם', hint: 'חם ורך לעין' },
    { v: 'sepia', label: 'ספיה', hint: 'כמו דף ישן' },
    { v: 'dark', label: 'כהה', hint: 'לשעות הלילה' },
    { v: 'eink', label: 'דיו אלקטרוני', hint: 'שחור־לבן חד, בלי אנימציות. מומלץ ל־Boox ולקוראים' },
  ]
  const ACCENTS: { v: Settings['accent']; c: string; n: string }[] = [
    { v: 'clay', c: '#c2643f', n: 'חימר' },
    { v: 'blue', c: '#3f62b5', n: 'כחול' },
    { v: 'green', c: '#3f7a5a', n: 'ירוק' },
    { v: 'plum', c: '#8a4b8f', n: 'שזיף' },
    { v: 'graphite', c: '#3d3d3a', n: 'גרפיט' },
  ]
  const SCALES: Opt[] = [
    { v: 0.9, label: 'קטן' },
    { v: 1, label: 'רגיל' },
    { v: 1.12, label: 'גדול' },
    { v: 1.25, label: 'גדול מאוד' },
    { v: 1.4, label: 'ענק' },
  ]
  const PAPERS: Opt[] = [
    { v: 'plain', label: 'נקי' },
    { v: 'lined', label: 'שורות (מחברת)' },
    { v: 'grid', label: 'משבצות' },
    { v: 'dots', label: 'נקודות' },
  ]
  const LINE_H: Opt[] = [
    { v: 1.45, label: 'צפוף' },
    { v: 1.7, label: 'רגיל' },
    { v: 2, label: 'מרווח' },
    { v: 2.3, label: 'מרווח מאוד' },
  ]
  const MARGINS: Opt[] = [
    { v: 'narrow', label: 'צרים' },
    { v: 'normal', label: 'רגילים' },
    { v: 'wide', label: 'רחבים' },
  ]
  const SILENCE: Opt[] = [
    { v: 600, label: 'קצרה (0.6 שנ׳)', hint: 'טקסט מופיע מהר יותר' },
    { v: 900, label: 'רגילה (0.9 שנ׳)' },
    { v: 1400, label: 'ארוכה (1.4 שנ׳)', hint: 'למי שעוצר לחשוב באמצע משפט' },
  ]
  const AUTOSTOP: Opt[] = [
    { v: 0, label: 'אף פעם' },
    { v: 15, label: 'אחרי 15 שניות שקט' },
    { v: 30, label: 'אחרי 30 שניות שקט' },
    { v: 60, label: 'אחרי דקה של שקט' },
  ]
  const PROCESSING: Opt[] = [
    { v: 'auto', label: 'אוטומטי', hint: 'מהיר, ועובר לבטוח לבד אם יש בעיה' },
    { v: 'fast', label: 'מהיר', hint: 'מנוע נייטיב, ריבוי מעבדים' },
    { v: 'safe', label: 'בטוח', hint: 'איטי יותר, אבל יציב בכל מכשיר' },
  ]
  const SENS: Opt[] = [
    { v: 'quiet', label: 'חדר שקט', hint: 'קולט גם דיבור חלש' },
    { v: 'normal', label: 'רגיל' },
    { v: 'noisy', label: 'סביבה רועשת', hint: 'מתעלם מרעשי רקע' },
  ]
  const LOCK: Opt[] = [
    { v: 0, label: 'מיד כשיוצאים מהאפליקציה' },
    { v: 1, label: 'אחרי דקה' },
    { v: 5, label: 'אחרי 5 דקות' },
    { v: 15, label: 'אחרי 15 דקות' },
    { v: -1, label: 'רק כשנועלים ידנית' },
  ]
  const PREVIEW: Opt[] = [
    { v: 0, label: 'בלי תצוגה מקדימה' },
    { v: 1, label: 'שורה אחת' },
    { v: 2, label: 'שתי שורות' },
    { v: 3, label: 'שלוש שורות' },
  ]

  // ---------- password ----------
  async function setPassword() {
    if (store.hasLock) {
      const old = await promptDialog('הסיסמה הנוכחית', '', '', 'המשך', 'password')
      if (old === null) return
      if (!(await store.checkPassword(old))) return alertDialog('הסיסמה שגויה')
    }
    const p1 = await promptDialog(store.hasLock ? 'סיסמה חדשה' : 'בחירת סיסמה', '', 'לפחות 4 תווים', 'המשך', 'password')
    if (p1 === null) return
    if (p1.length < 4) return alertDialog('הסיסמה קצרה מדי', 'צריך לפחות 4 תווים.')
    const p2 = await promptDialog('הקלידו שוב לאישור', '', '', 'שמירה', 'password')
    if (p2 !== p1) return alertDialog('הסיסמאות לא תואמות')
    await store.setPassword(p1)
    await alertDialog('הסיסמה נשמרה', 'כל ההערות מוצפנות עכשיו על המכשיר.\nשימו לב: אם שוכחים את הסיסמה אין דרך לשחזר את ההערות. מומלץ לשמור גיבוי.')
  }

  async function removePassword() {
    const old = await promptDialog('הסיסמה הנוכחית', '', '', 'הסרה', 'password')
    if (old === null) return
    if (!(await store.checkPassword(old))) return alertDialog('הסיסמה שגויה')
    await store.removePassword()
    store.say('הסיסמה הוסרה')
  }

  // ---------- fonts ----------
  async function addFontFile() {
    const f = await pickFile('.ttf,.otf,.woff,.woff2,font/*')
    if (!f) return
    try {
      const name = await addCustomFont(f.name, await f.arrayBuffer())
      store.say(`הגופן "${name}" נוסף`)
    } catch {
      alertDialog('לא הצלחתי לטעון את הגופן', 'ודאו שזה קובץ גופן מסוג TTF, OTF או WOFF.')
    }
  }

  async function openSystemFonts() {
    try {
      sysFonts = (await Native.listSystemFonts()).fonts.sort((a, b) => a.name.localeCompare(b.name))
      sysFontsOpen = true
    } catch {
      alertDialog('לא ניתן לקרוא את הגופנים של המכשיר')
    }
  }

  async function addSystemFont(f: { name: string; file: string }) {
    sysFontsOpen = false
    try {
      const { data } = await Native.readFileBase64({ path: f.file })
      const name = await addCustomFont(f.name, fromB64(data).buffer)
      store.say(`הגופן "${name}" נוסף`)
    } catch {
      alertDialog('לא הצלחתי לטעון את הגופן הזה')
    }
  }

  async function delFont(name: string) {
    if (await confirmDialog(`להסיר את "${name}"?`, '', 'הסרה', true)) {
      await removeCustomFont(name)
      if (settings.editorFont === name) set('editorFont', 'Assistant')
    }
  }

  // ---------- models ----------
  async function downloadModel(id: EngineId) {
    const m = engine.model(id)
    if (isNative && engine.ramMB && engine.ramMB < m.minRamMB) {
      const ok = await confirmDialog(
        'המכשיר עלול להיות חלש מדי',
        `במכשיר יש כ־${Math.round(engine.ramMB / 100) / 10}GB זיכרון. המודל הזה צריך בערך ${Math.round(m.minRamMB / 100) / 10}GB כדי לעבוד בנוחות, ועלול להיות איטי מאוד או להיסגר.\nלהוריד בכל זאת?`,
        'להוריד',
      )
      if (!ok) return
    }
    await engine.download(id)
  }

  async function deleteModel(id: EngineId) {
    if (await confirmDialog('למחוק את המודל מהמכשיר?', 'אפשר להוריד אותו שוב בכל זמן.', 'מחיקה', true)) await engine.remove(id)
  }

  function useModel(id: EngineId) {
    set('engine', id)
    store.say('נבחר: ' + engine.model(id).name)
  }

  // ---------- dictionary ----------
  async function addReplacement() {
    const from = await promptDialog('מה המודל כותב בטעות?', '', 'למשל: בתל')
    if (!from?.trim()) return
    const to = await promptDialog(`במה להחליף את "${from}"?`, '', 'למשל: בטל')
    if (to === null) return
    settings.replacements = [...settings.replacements, { from: from.trim(), to }]
    saveSettings()
  }

  function delReplacement(i: number) {
    settings.replacements = settings.replacements.filter((_, j) => j !== i)
    saveSettings()
  }

  async function editVocabulary() {
    const v = await promptDialog('מילים חשובות', settings.vocabulary, 'שמות, מונחים, מילים מקצועיות, מופרדים בפסיק')
    if (v !== null) set('vocabulary', v)
  }

  // ---------- backup ----------
  async function importBackup() {
    const f = await pickFile('.json,application/json')
    if (!f) return
    try {
      const r = await store.importJson(await f.text())
      alertDialog('הגיבוי שוחזר', `נוספו ${r.notes} הערות ו־${r.folders} תיקיות.`)
    } catch {
      alertDialog('הקובץ לא נראה כמו גיבוי של פתקול')
    }
  }

  async function reset() {
    if (await confirmDialog('לאפס את כל ההגדרות?', 'ההערות לא יימחקו.', 'איפוס', true)) resetSettings()
  }

  function fmtMB(mb: number) {
    return mb >= 1000 ? (mb / 1000).toFixed(1) + 'GB' : mb + 'MB'
  }
</script>

{#snippet row(icon: string, title: string, value: string, onclick: () => void, hint = '')}
  <button class="srow" {onclick}>
    <span class="s-ic"><Icon name={icon} size={21} /></span>
    <span class="s-txt"><span class="s-t">{title}</span>{#if hint}<span class="s-h">{hint}</span>{/if}</span>
    <span class="s-v">{value}</span>
    <span class="chev"><Icon name="forward" size={17} /></span>
  </button>
{/snippet}

{#snippet toggle(icon: string, title: string, key: keyof Settings, hint = '')}
  <button class="srow" onclick={() => set(key, !settings[key] as never)} role="switch" aria-checked={!!settings[key]}>
    <span class="s-ic"><Icon name={icon} size={21} /></span>
    <span class="s-txt"><span class="s-t">{title}</span>{#if hint}<span class="s-h">{hint}</span>{/if}</span>
    <span class="sw" class:on={!!settings[key]}><span></span></span>
  </button>
{/snippet}

<div class="screen">
  <header class="topbar">
    <button class="icon-btn" aria-label="חזרה" onclick={() => store.back()}><Icon name="back" /></button>
    <div class="title">הגדרות</div>
  </header>

  <div class="scroll">
    <!-- APPEARANCE -->
    <div class="group" id="sec-look">
      <div class="g-title">מראה</div>
      <div class="themes">
        {#each THEMES as t (t.v)}
          <button class="theme t-{t.v}" class:sel={settings.theme === t.v} onclick={() => set('theme', t.v as Settings['theme'])}>
            <span class="t-prev"><i></i><i></i><i></i></span>
            <span class="t-name">{t.label}</span>
          </button>
        {/each}
      </div>
      {#if settings.theme !== 'eink'}
        <div class="accents">
          <span class="muted">צבע מוביל</span>
          {#each ACCENTS as a (a.v)}
            <button class="acc" class:sel={settings.accent === a.v} style="--c:{a.c}" aria-label={a.n} onclick={() => set('accent', a.v)}></button>
          {/each}
        </div>
      {/if}
      {@render row('textSize', 'גודל הממשק', label('uiScale', SCALES), () => choose('uiScale', 'גודל הממשק', SCALES))}
      {@render row('type', 'גופן הממשק', fontLabel(settings.uiFont), () => choose('uiFont', 'גופן הממשק', allFontChoices().map((f) => ({ v: f.family, label: f.label }))))}
      {@render row('list', 'שורות תצוגה מקדימה', label('previewLines', PREVIEW), () => choose('previewLines', 'תצוגה מקדימה ברשימה', PREVIEW))}
      {@render row('lines', 'צפיפות הרשימה', settings.density === 'compact' ? 'צפופה' : 'מרווחת', () =>
        choose('density', 'צפיפות הרשימה', [{ v: 'comfortable', label: 'מרווחת' }, { v: 'compact', label: 'צפופה' }]))}
      {@render toggle('info', 'הצגת תאריכים ברשימה', 'showDates')}
      {#if settings.theme !== 'eink'}{@render toggle('sparkle', 'אנימציות עדינות', 'animations', 'כבוי חוסך סוללה ומתאים למסכי דיו')}{/if}
    </div>

    <!-- EDITOR -->
    <div class="group" id="sec-editor">
      <div class="g-title">כתיבה</div>
      {@render row('font', 'גופן ברירת מחדל', fontLabel(settings.editorFont), () => choose('editorFont', 'גופן ברירת מחדל', allFontChoices().map((f) => ({ v: f.family, label: f.label }))))}
      <div class="srow static">
        <span class="s-ic"><Icon name="textSize" size={21} /></span>
        <span class="s-txt"><span class="s-t">גודל טקסט</span></span>
        <div class="stepper">
          <button onclick={() => set('editorSize', Math.max(12, settings.editorSize - 1))} aria-label="הקטנה"><Icon name="minus" size={18} /></button>
          <b>{settings.editorSize}</b>
          <button onclick={() => set('editorSize', Math.min(40, settings.editorSize + 1))} aria-label="הגדלה"><Icon name="plus" size={18} /></button>
        </div>
      </div>
      <div class="preview" style="font-family:{fontStack(settings.editorFont)}; font-size:{settings.editorSize}px; line-height:{settings.lineHeight}">
        כך ייראה הטקסט שלכם. שלום עליכם, והרבה הצלחה!
      </div>
      {@render row('lines', 'ריווח שורות', label('lineHeight', LINE_H), () => choose('lineHeight', 'ריווח שורות', LINE_H))}
      {@render row('blank', 'סוג דף להערה חדשה', label('defaultPaper', PAPERS), () => choose('defaultPaper', 'סוג דף להערה חדשה', PAPERS))}
      {@render row('alignJustify', 'שוליים', label('pageMargin', MARGINS), () => choose('pageMargin', 'שוליים', MARGINS))}
      {@render row('type', 'מיקום סרגל העיצוב', settings.toolbarPosition === 'top' ? 'למעלה' : 'למטה', () =>
        choose('toolbarPosition', 'מיקום סרגל העיצוב', [{ v: 'top', label: 'למעלה' }, { v: 'bottom', label: 'למטה, ליד המקלדת' }]))}
      {@render toggle('h', 'שדה כותרת נפרד', 'showTitle')}
      {@render toggle('info', 'ספירת מילים', 'showWordCount')}
      {@render toggle('check', 'בדיקת איות', 'spellcheck', 'הקו האדום של המקלדת')}
    </div>

    <!-- FONTS -->
    <div class="group" id="sec-fonts">
      <div class="g-title">גופנים</div>
      <div class="font-list">
        {#each allFontChoices().filter((f) => f.kind !== 'custom') as f (f.family)}
          <span class="chip" style="font-family:{fontStack(f.family)}">{f.label}</span>
        {/each}
      </div>
      {#each fontState.custom as f (f.family)}
        <div class="srow static">
          <span class="s-ic"><Icon name="font" size={21} /></span>
          <span class="s-txt" style="font-family:{fontStack(f.family)}"><span class="s-t">{f.label}</span><span class="s-h">אבג דהו · Abc 123</span></span>
          <button class="icon-btn" aria-label="הסרה" onclick={() => delFont(f.family)}><Icon name="trash" size={19} /></button>
        </div>
      {/each}
      {@render row('upload', 'הוספת גופן מקובץ', '', addFontFile, 'TTF, OTF או WOFF')}
      {#if isNative}{@render row('device', 'גופנים שמותקנים במכשיר', '', openSystemFonts)}{/if}
    </div>

    <!-- DICTATION -->
    <div class="group" id="sec-dictation">
      <div class="g-title">הכתבה (דיבור לטקסט)</div>
      <p class="g-note">הדיבור מתומלל על המכשיר עצמו, בלי אינטרנט ובלי לשלוח הקלטות לשום מקום. צריך להוריד מודל פעם אחת.</p>
      {#each MODELS as m (m.id)}
        {@const st = engine.status[m.id]}
        <div class="model" class:active={settings.engine === m.id}>
          <div class="m-head">
            <span class="m-name">{m.name}</span>
            <span class="m-size">{fmtMB(m.sizeMB)}</span>
          </div>
          <div class="m-desc">{m.description}</div>
          {#if !engine.available(m.id)}
            <div class="m-desc faint">זמין רק באפליקציה לאנדרואיד.</div>
          {:else if st === 'downloading'}
            <div class="prog"><span style="width:{Math.round(engine.progress[m.id] * 100)}%"></span></div>
            <div class="m-actions"><span class="muted">מוריד… {Math.round(engine.progress[m.id] * 100)}%</span><button class="btn ghost" onclick={() => engine.cancel()}>ביטול</button></div>
          {:else if st === 'missing' || st === 'error'}
            <div class="m-actions"><button class="btn primary" onclick={() => downloadModel(m.id)}><Icon name="download" size={19} /> הורדה</button></div>
          {:else}
            <div class="m-actions">
              {#if settings.engine === m.id}
                <span class="in-use"><Icon name="check" size={18} stroke={2.4} /> בשימוש</span>
              {:else}
                <button class="btn primary" onclick={() => useModel(m.id)}>שימוש במודל הזה</button>
              {/if}
              {#if isNative}<button class="btn ghost danger" onclick={() => deleteModel(m.id)}>מחיקה</button>{/if}
            </div>
          {/if}
        </div>
      {/each}
      {#if engine.error}<p class="g-note err">{engine.error}</p>{/if}
      {#if isNative}
        {@render row('settings', 'מנוע עיבוד', label('processing', PROCESSING) + (engine.nativeBroken && settings.processing === 'auto' ? ' (בטוח)' : ''), () => choose('processing', 'מנוע עיבוד', PROCESSING), engine.nativeBroken ? 'המנוע המהיר נכשל במכשיר הזה, לכן משתמשים בבטוח' : '')}
        {#if engine.nativeBroken}
          {@render row('refresh', 'לנסות שוב את המנוע המהיר', '', () => { engine.resetNativeBroken(); store.say('בפעם הבאה ננסה את המנוע המהיר') })}
        {/if}
      {/if}
      {@render toggle('sparkle', 'עבודה רגועה', 'calm', 'פחות מעבדים והפסקות קטנות. איטי יותר, אבל לא מעמיס על מכשיר חלש')}
      {@render toggle('lines', 'סידור אוטומטי בסוף הקלטה ארוכה', 'tidyAfter', 'פיסוק ופסקאות לטקסט שתומלל')}
      {#if isNative}
        {@render row('refresh', 'לאפשר עבודה ברקע', '', () => Native.requestIgnoreBatteryOptimizations().catch(() => {}), 'כדי שהמכשיר לא יעצור תמלול ארוך כשהמסך כבוי')}
      {/if}
      {@render row('wave', 'הפסקה שסוגרת משפט', label('silenceMs', SILENCE), () => choose('silenceMs', 'כמה זמן שקט מסיים משפט', SILENCE))}
      {@render row('mic', 'רגישות המיקרופון', label('sensitivity', SENS), () => choose('sensitivity', 'רגישות המיקרופון', SENS))}
      {@render row('stop', 'עצירה אוטומטית', label('autoStopSec', AUTOSTOP), () => choose('autoStopSec', 'עצירה אוטומטית', AUTOSTOP))}
      {@render row('pen', 'איפה להוסיף את הטקסט', settings.insertAt === 'cursor' ? 'במקום הסמן' : 'בסוף ההערה', () =>
        choose('insertAt', 'איפה להוסיף את הטקסט', [{ v: 'cursor', label: 'במקום הסמן' }, { v: 'end', label: 'תמיד בסוף ההערה' }]))}
      {@render toggle('sparkle', 'פקודות קוליות', 'voiceCommands', 'אומרים "נקודה", "פסיק", "שורה חדשה", "פסקה חדשה"')}
      {@render toggle('eye', 'המסך לא נכבה בזמן הכתבה', 'keepScreenOn')}
      {@render row('dictionary', 'מילון תיקונים', settings.replacements.length ? settings.replacements.length + ' תיקונים' : '', () => (dictOpen = true), 'מילה שנכתבת לא נכון? מתקנים פעם אחת וזהו')}
      {@render row('sparkle', 'מילים חשובות למודל המדויק', settings.vocabulary ? '✓' : '', editVocabulary, 'שמות ומונחים שהמודל המדויק ישים לב אליהם')}
    </div>

    <!-- PRIVACY -->
    <div class="group" id="sec-privacy">
      <div class="g-title">פרטיות ונעילה</div>
      {#if store.hasLock}
        {@render row('lock', 'שינוי סיסמה', '', setPassword)}
        {@render row('lock', 'נעילה אוטומטית', label('autoLockMin', LOCK), () => choose('autoLockMin', 'נעילה אוטומטית', LOCK))}
        {@render row('unlock', 'הסרת הסיסמה', '', removePassword)}
      {:else}
        {@render row('lock', 'הגדרת סיסמה', 'כבוי', setPassword, 'ההערות יוצפנו ויוצגו רק אחרי הקשת הסיסמה')}
      {/if}
      {@render toggle('trash', 'לשאול לפני מחיקה', 'confirmDelete')}
      {@render row('trash', 'סל המחזור', '', () => store.go({ name: 'trash' }))}
    </div>

    <!-- BACKUP -->
    <div class="group" id="sec-backup">
      <div class="g-title">גיבוי</div>
      {@render row('backup', 'שמירת גיבוי', '', exportBackup, 'קובץ אחד עם כל ההערות והתיקיות')}
      {@render row('restore', 'שחזור מגיבוי', '', importBackup)}
    </div>

    <!-- UPDATES -->
    <div class="group" id="sec-updates">
      <div class="g-title">עדכונים</div>
      <div class="upd">
        <div>
          <div class="s-t">גרסה {APP_VERSION}</div>
          <div class="s-h">
            {#if updater.state === 'checking'}בודק…
            {:else if updater.state === 'latest'}יש לכם את הגרסה האחרונה
            {:else if updater.state === 'available'}גרסה {updater.latest?.version} זמינה ({updater.latest?.sizeMB}MB)
            {:else if updater.state === 'downloading'}מוריד עדכון… {Math.round(updater.progress * 100)}%
            {:else if updater.message}{updater.message}
            {:else}בדיקה מול שרת העדכונים{/if}
          </div>
        </div>
        {#if updater.state === 'available'}
          <button class="btn primary" onclick={() => updater.install()}>התקנה</button>
        {:else}
          <button class="btn" disabled={updater.state === 'checking' || updater.state === 'downloading'} onclick={() => updater.check()}>בדיקה</button>
        {/if}
      </div>
      {#if updater.state === 'available' && updater.latest?.notes}<p class="g-note">{updater.latest.notes}</p>{/if}
      {#if updater.message && updater.state === 'available'}<p class="g-note err">{updater.message}</p>{/if}
      {@render toggle('refresh', 'לבדוק עדכונים בכל פתיחה', 'autoCheckUpdates')}
    </div>

    <div class="group">
      {@render row('help', 'מדריך קצר', '', () => store.go({ name: 'help' }))}
      {@render row('heart', 'אודות והודות', '', () => store.go({ name: 'about' }))}
      {@render row('refresh', 'איפוס הגדרות', '', reset)}
    </div>
    <div style="height:40px"></div>
  </div>
</div>

<Sheet bind:open={pickOpen} title={pick?.title}>
  {#if pick}
    {@const p = pick}
    {#each p.opts as o (String(o.v))}
      <MenuItem label={o.label} hint={o.hint} selected={settings[p.key] === o.v} onclick={() => { set(p.key, o.v as never); pickOpen = false }} />
    {/each}
  {/if}
</Sheet>

<Sheet bind:open={sysFontsOpen} title="גופני המכשיר">
  {#each sysFonts as f (f.file)}
    <MenuItem icon="font" label={f.name} onclick={() => addSystemFont(f)} />
  {/each}
</Sheet>

<Sheet bind:open={dictOpen} title="מילון תיקונים">
  <p class="g-note">כל פעם שהמודל כותב את המילה שמשמאל, היא תוחלף אוטומטית במילה שמימין.</p>
  {#each settings.replacements as r, i (i)}
    <div class="rep">
      <span class="from">{r.from}</span><Icon name="forward" size={16} /><span class="to">{r.to || '(מחיקה)'}</span>
      <button class="icon-btn" aria-label="הסרה" onclick={() => delReplacement(i)}><Icon name="close" size={18} /></button>
    </div>
  {/each}
  <MenuItem icon="plus" label="הוספת תיקון" onclick={addReplacement} />
</Sheet>

<style>
  .group { margin: 8px 14px 14px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-lg); overflow: hidden; }
  :global([data-theme='eink']) .group { border: 1.5px solid #000; }
  .g-title { font-family: var(--font-display); font-weight: 700; font-size: 1.15rem; padding: 16px 18px 6px; }
  .g-note { margin: 0; padding: 0 18px 10px; font-size: 0.88rem; color: var(--muted); line-height: 1.55; white-space: pre-line; }
  .g-note.err { color: var(--danger); }

  .srow { width: 100%; display: flex; align-items: center; gap: 14px; min-height: 58px; padding: 8px 18px; text-align: start; border-top: 1px solid var(--line); }
  .srow:active:not(.static) { background: var(--surface-2); }
  .s-ic { color: var(--muted); display: grid; }
  .s-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .s-t { font-weight: 600; }
  .s-h { font-size: 0.82rem; color: var(--muted); line-height: 1.4; }
  .s-v { color: var(--muted); font-size: 0.92rem; white-space: nowrap; }
  .chev { color: var(--faint); display: grid; }

  .sw { width: 46px; height: 28px; border-radius: 99px; background: var(--surface-3); position: relative; flex: none; transition: background var(--speed); }
  .sw span { position: absolute; top: 3px; inset-inline-start: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgb(0 0 0 / 0.25); transition: inset-inline-start var(--speed); }
  .sw.on { background: var(--accent); }
  .sw.on span { inset-inline-start: 21px; }
  :global([data-theme='eink']) .sw { border: 2px solid #000; background: #fff; }
  :global([data-theme='eink']) .sw span { background: #000; box-shadow: none; top: 1px; }
  :global([data-theme='eink']) .sw.on { background: #000; }
  :global([data-theme='eink']) .sw.on span { background: #fff; }

  .themes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; padding: 6px 14px 12px; }
  .theme { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 4px; border-radius: var(--radius); border: 2px solid transparent; }
  .theme.sel { border-color: var(--accent); }
  .t-prev { width: 100%; aspect-ratio: 1 / 1.15; border-radius: 10px; padding: 8px 7px; display: flex; flex-direction: column; gap: 5px; border: 1px solid var(--line); }
  .t-prev i { height: 5px; border-radius: 3px; display: block; }
  .t-prev i:nth-child(1) { width: 70%; }
  .t-prev i:nth-child(3) { width: 50%; }
  .t-paper .t-prev { background: #fffefb; } .t-paper i { background: #c9c2b4; } .t-paper i:first-child { background: #c2643f; }
  .t-sepia .t-prev { background: #faf3e5; } .t-sepia i { background: #cdbb9b; } .t-sepia i:first-child { background: #8a5a35; }
  .t-dark .t-prev { background: #242320; } .t-dark i { background: #55524b; } .t-dark i:first-child { background: #e08a64; }
  .t-eink .t-prev { background: #fff; border: 1.5px solid #000; } .t-eink i { background: #000; }
  .t-name { font-size: 0.85rem; font-weight: 600; }

  .accents { display: flex; align-items: center; gap: 10px; padding: 2px 18px 14px; font-size: 0.9rem; }
  .acc { width: 32px; height: 32px; border-radius: 50%; background: var(--c); border: 3px solid var(--surface); box-shadow: 0 0 0 1.5px var(--line-strong); }
  .acc.sel { box-shadow: 0 0 0 2.5px var(--c); }

  .stepper { display: flex; align-items: center; gap: 4px; background: var(--surface-2); border-radius: 12px; }
  .stepper button { width: 40px; height: 40px; display: grid; place-items: center; }
  .stepper b { min-width: 28px; text-align: center; font-variant-numeric: tabular-nums; }
  .preview { margin: 0 18px 12px; padding: 12px 14px; border-radius: var(--radius); background: var(--surface-2); }

  .font-list { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 18px 14px; }
  .chip { padding: 5px 12px; border-radius: 99px; background: var(--surface-2); font-size: 1rem; }
  :global([data-theme='eink']) .chip { border: 1px solid #000; }

  .model { margin: 6px 14px 10px; padding: 14px 16px; border-radius: var(--radius); border: 1.5px solid var(--line); }
  .model.active { border-color: var(--accent); background: var(--accent-soft); }
  :global([data-theme='eink']) .model.active { border-width: 3px; background: #fff; }
  .m-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .m-name { font-weight: 700; font-size: 1.05rem; }
  .m-size { font-size: 0.82rem; color: var(--muted); }
  .m-desc { font-size: 0.88rem; color: var(--muted); margin-top: 4px; line-height: 1.5; }
  .m-actions { display: flex; align-items: center; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
  .in-use { display: inline-flex; gap: 6px; align-items: center; font-weight: 700; color: var(--accent-text); }
  .prog { height: 7px; border-radius: 9px; background: var(--surface-3); margin-top: 12px; overflow: hidden; }
  .prog span { display: block; height: 100%; background: var(--accent); }

  .upd { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 18px 14px; }
  .rep { display: flex; align-items: center; gap: 10px; padding: 4px 22px; }
  .rep .from { color: var(--danger); text-decoration: line-through; }
  .rep .to { flex: 1; font-weight: 700; }
</style>
