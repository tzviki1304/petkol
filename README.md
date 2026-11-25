# פתקול · Petkol

אפליקציית הערות לאנדרואיד בעברית, עם **הכתבה בלי אינטרנט**: מדברים, והטקסט נכתב. התמלול נעשה על המכשיר עצמו.

**פתקול** = פתק + קול.

## מה יש בה
- הכתבה בעברית על המכשיר, בלי אינטרנט: מודל רגיל (Ozen-v1) ומודל מדויק לבחירה (ivrit.ai large-v3-turbo).
- עורך כמו מעבד תמלילים: גופנים, גודל, הדגשה, צבעים, סימון, כותרות, יישור, רשימות ומשימות עם וי.
- תיקיות בתוך תיקיות, חיפוש, הצמדה, העברה וסל מחזור.
- דפים: נקי, שורות של מחברת, משבצות ונקודות.
- סיסמה שמצפינה את כל ההערות (AES-256).
- ייצוא ל-PDF ושיתוף.
- ערכות צבעים: קרם, ספיה, כהה ודיו אלקטרוני (למכשירי Boox).
- גופנים עבריים מובנים, ואפשר להוסיף גופנים מקובץ או מהמכשיר.
- גיבוי ושחזור, ועדכון מתוך האפליקציה דרך GitHub Releases.

## התקנה
מורידים את קובץ ה-APK מ-[Releases](https://github.com/tzviki1304/petkol/releases/latest) ומתקינים. בפעם הראשונה מורידים את מודל הדיבור (בהגדרות ← הכתבה).

## פיתוח
ראו [HANDOFF.md](HANDOFF.md).

## הודות
- [Ozen-v1](https://huggingface.co/itayinbar/Ozen-v1) (Apache-2.0)
- [ivrit.ai](https://www.ivrit.ai/)
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
- [ONNX Runtime](https://onnxruntime.ai/)
- [Transformers.js](https://github.com/huggingface/transformers.js)
- [Tiptap](https://tiptap.dev/)
- [Capacitor](https://capacitorjs.com/)
- הגופנים מ-[Google Fonts](https://fonts.google.com/) (OFL)

יחי אדוננו מורנו ורבנו מלך המשיח לעולם ועד
