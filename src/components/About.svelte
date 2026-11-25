<script lang="ts">
  import Icon from './Icon.svelte'
  import Logo from './Logo.svelte'
  import { store } from '../lib/store.svelte'
  import { settings } from '../lib/settings.svelte'
  import { APP_VERSION } from '../lib/update.svelte'
</script>

<div class="screen">
  <header class="topbar">
    <button class="icon-btn" aria-label="חזרה" onclick={() => store.back()}><Icon name="back" /></button>
    <div class="title">אודות</div>
  </header>
  <div class="scroll">
    <div class="hero">
      <Logo size={88} mono={settings.theme === 'eink'} />
      <h1>פתקול</h1>
      <div class="ver">גרסה {APP_VERSION}</div>
    </div>

    <div class="blessing">יחי אדוננו מורנו ורבנו מלך המשיח לעולם ועד</div>

    <section>
      <h2>מה פירוש השם?</h2>
      <p><b>פתקול</b> = <b>פתק</b> + <b>קול</b>. אפליקציית הערות שאפשר גם לכתוב בה וגם לדבר אליה, והדיבור הופך לטקסט כתוב.</p>
    </section>

    <section>
      <h2>מה היא עושה?</h2>
      <ul>
        <li><b>הכתבה בלי אינטרנט:</b> מדברים, והטקסט נכתב. התמלול נעשה על המכשיר עצמו, ההקלטות לא נשלחות לשום מקום.</li>
        <li><b>הערות כמו במעבד תמלילים:</b> גופנים, גדלים, הדגשה, צבעים, כותרות, רשימות ויישור.</li>
        <li><b>תיקיות בתוך תיקיות:</b> למשל שיעורים ← הרב כהן ← שיעור בתניא.</li>
        <li><b>דפים לבחירה:</b> נקי, שורות של מחברת, משבצות, נקודות, ורשימות משימות עם וי.</li>
        <li><b>פרטיות:</b> סיסמה שמצפינה את כל ההערות על המכשיר.</li>
        <li><b>שיתוף:</b> כטקסט או כקובץ PDF מעוצב.</li>
        <li><b>מתאימה למסכי דיו:</b> מצב שחור־לבן חד למכשירי Boox ודומיהם.</li>
      </ul>
    </section>

    <section>
      <h2>הודות</h2>
      <p>תודה לבורא עולם על כל הטוב.</p>
      <p class="credits">
        מודל הדיבור הרגיל: <b>Ozen-v1</b>, מודל עברי קטן מבוסס Whisper (רישיון Apache-2.0).<br />
        המודל המדויק: <b>ivrit.ai</b>, פרויקט קוד פתוח לזיהוי דיבור בעברית. הנתונים והמודלים שלו הם בסיס לשני המודלים.<br />
        <b>OpenAI Whisper</b>, <b>whisper.cpp</b>, <b>ONNX Runtime</b> ו־<b>Transformers.js</b> מריצים את המודלים על המכשיר.<br />
        העורך מבוסס על <b>Tiptap</b>. הגופנים העבריים מ־<b>Google Fonts</b> (רישיון OFL).
      </p>
    </section>

    <div class="foot">נבנה באהבה · כל ההערות נשמרות רק על המכשיר שלכם</div>
    <div style="height:40px"></div>
  </div>
</div>

<style>
  .hero { display: flex; flex-direction: column; align-items: center; padding: 16px 20px 6px; }
  h1 { font-family: var(--font-display); font-size: 2.3rem; margin: 12px 0 0; }
  .ver { color: var(--faint); font-size: 0.85rem; }
  .blessing {
    margin: 22px 18px 8px; padding: 18px 16px; text-align: center;
    font-family: var(--font-display); font-size: 1.3rem; font-weight: 700; line-height: 1.5;
    border-radius: var(--radius-lg); background: var(--accent-soft); color: var(--accent-text);
  }
  :global([data-theme='eink']) .blessing { border: 2px solid #000; background: #fff; color: #000; }
  section { margin: 14px 18px; }
  h2 { font-family: var(--font-display); font-size: 1.2rem; margin: 18px 0 6px; }
  p, li { line-height: 1.7; }
  p { margin: 0 0 8px; }
  ul { padding-inline-start: 1.2em; margin: 0; }
  li { margin-bottom: 6px; }
  .credits { color: var(--muted); font-size: 0.93rem; }
  .foot { text-align: center; color: var(--faint); font-size: 0.85rem; margin-top: 24px; }
</style>
