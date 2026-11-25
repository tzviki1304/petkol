<script lang="ts">
  import Icon from './Icon.svelte'
  import { store } from '../lib/store.svelte'

  const TIPS: { icon: string; t: string; d: string }[] = [
    { icon: 'mic', t: 'מדברים במקום להקליד', d: 'בתוך הערה לוחצים על כפתור המיקרופון העגול ומדברים כרגיל. אחרי כל הפסקה קצרה המשפט נכתב. לוחצים שוב כדי לעצור. במסך הראשי, "הכתבה" פותח הערה חדשה ומתחיל להקשיב מיד.' },
    { icon: 'wave', t: 'הקלטה ארוכה', d: '"חדש" ← הקלטה ארוכה, או מתפריט ההערה. מדברים 5 דקות או שעה, ואפשר לכבות את המסך. אחרי "סיום" המכשיר מתמלל ברקע, לאט ובשקט, ומראה את ההתקדמות. כך הוא לא נעמס, והתמלול יוצא מדויק יותר.' },
    { icon: 'sparkle', t: 'סידור ועימוד', d: '"חדש" ← סידור טקסט: מדביקים טקסט ומקבלים הערה מסודרת. בתוך הערה: תפריט ← סידור הטקסט מוסיף פיסוק, פסקאות, כותרות והדגשות, ואפשר לבחור סגנון (מודרני, קלאסי, ספר). לא אהבתם? "ביטול".' },
    { icon: 'download', t: 'בפעם הראשונה', d: 'צריך להוריד את מודל הדיבור פעם אחת (בהגדרות ← הכתבה). אחר כך הכול עובד בלי אינטרנט.' },
    { icon: 'sparkle', t: 'שני מודלים', d: '"רגיל" מהיר ומתאים לכל מכשיר. "מדויק" כבד יותר ומבין טוב יותר מילים נדירות, שמות ומונחים מקצועיים, אבל צריך מכשיר חזק.' },
    { icon: 'dictionary', t: 'מילה נכתבת לא נכון?', d: 'בהגדרות ← מילון תיקונים מוסיפים אותה פעם אחת, והיא תתוקן אוטומטית מעכשיו.' },
    { icon: 'type', t: 'לעצב כמו בוורד', d: 'כפתור ה־T למעלה פותח את סרגל העיצוב: גופן, גודל (+ −), הדגשה, צבע, כותרות, יישור ורשימות. מסמנים טקסט ובוחרים.' },
    { icon: 'lines', t: 'דף מחברת', d: 'בתפריט ההערה (שלוש הנקודות) ← סוג דף: נקי, שורות, משבצות או נקודות. ברירת המחדל להערות חדשות נקבעת בהגדרות.' },
    { icon: 'checklist', t: 'רשימת משימות', d: 'בוחרים "חדש" ← רשימת משימות, או לוחצים על כפתור המשימות בסרגל. נוגעים בריבוע כדי לסמן וי.' },
    { icon: 'folder', t: 'תיקיות בתוך תיקיות', d: '"חדש" ← תיקייה חדשה. נכנסים לתיקייה ויוצרים בה עוד תיקיות והערות. לחיצה ארוכה על תיקייה או הערה פותחת אפשרויות: שינוי שם, העברה, מחיקה.' },
    { icon: 'pdf', t: 'PDF ושיתוף', d: 'בתפריט ההערה: "ייצוא ל־PDF ושיתוף" יוצר קובץ מעוצב לשליחה בוואטסאפ, במייל או לשמירה.' },
    { icon: 'lock', t: 'סיסמה', d: 'בהגדרות ← פרטיות. כל ההערות מוצפנות על המכשיר. חשוב: אם שוכחים את הסיסמה אי אפשר לשחזר, לכן כדאי לשמור גיבוי.' },
    { icon: 'palette', t: 'מראה', d: 'ערכות צבעים: קרם, ספיה, כהה, ודיו אלקטרוני שחור־לבן למסכי Boox. אפשר גם לשנות צבע מוביל, גודל ממשק וגופנים, ולהוסיף גופנים משלכם.' },
    { icon: 'refresh', t: 'עדכונים', d: 'בהגדרות ← עדכונים ← בדיקה. כשיש גרסה חדשה, לוחצים "התקנה" והיא מותקנת מעל הקיימת. ההערות נשארות.' },
  ]
</script>

<div class="screen">
  <header class="topbar">
    <button class="icon-btn" aria-label="חזרה" onclick={() => store.back()}><Icon name="back" /></button>
    <div class="title">מדריך קצר</div>
  </header>
  <div class="scroll">
    {#each TIPS as tip (tip.t)}
      <div class="tip">
        <span class="ic"><Icon name={tip.icon} size={22} /></span>
        <div>
          <div class="t">{tip.t}</div>
          <div class="d">{tip.d}</div>
        </div>
      </div>
    {/each}
    <div style="height:30px"></div>
  </div>
</div>

<style>
  .tip { display: flex; gap: 14px; margin: 0 14px 10px; padding: 14px 16px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-lg); }
  :global([data-theme='eink']) .tip { border: 1.5px solid #000; }
  .ic { width: 42px; height: 42px; flex: none; border-radius: 12px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent-text); }
  :global([data-theme='eink']) .ic { border: 1.5px solid #000; }
  .t { font-weight: 700; font-size: 1.05rem; margin-bottom: 2px; }
  .d { color: var(--muted); line-height: 1.6; font-size: 0.95rem; }
</style>
