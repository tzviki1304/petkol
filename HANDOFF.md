# פתקול: מסמך המשך עבודה

המסמך מסכם איך האפליקציה בנויה, איפה כל דבר נמצא, ואיך ממשיכים לפתח, בונים ומפרסמים גרסה.

> **למודל AI (Claude Code או אחר) שממשיך את העבודה:** קרא את כל המסמך הזה לפני שמתחילים. הוא מתאר את מצב הפרויקט נכון ל-25.11.2026. הקוד המלא נמצא ב-https://github.com/tzviki1304/petkol (ענף `main`). משכפלים עם `git clone https://github.com/tzviki1304/petkol.git`, ואז `npm install`.

## מצב נוכחי (גרסה 1.0.0)

- **מה זה:** אפליקציית הערות לאנדרואיד בעברית, עם הכתבה בלי אינטרנט. היא נבנתה בשביל מכשיר Boox Go 6 (מסך דיו, Android 11, ‏2GB זיכרון), אבל עובדת על כל אנדרואיד 64 ביט.
- **גרסה מפורסמת:** `v1.0.0` ב-GitHub Releases, קובץ `petkol-1.0.0.apk` (‏34MB, arm64-v8a, חתום).
- **מה נבדק בפועל:**
  - הממשק בדפדפן ועל אמולטור אנדרואיד.
  - הורדת המודל הרגיל מתוך האפליקציה.
  - תמלול עברית מקצה לקצה באפליקציה (הקלטת בדיקה של 13 שניות: כמעט כל המילים נכונות, כ-9 שניות על אמולטור).
  - PDF מהפלאגין הנייטיב.
  - גרסת ה-release נפתחת.
- **מה עוד לא נבדק:**
  - הקלטה אמיתית מהמיקרופון (באמולטור אין מיקרופון).
  - ביצועים על ה-Boox עצמו.
  - התקנת עדכון מקצה לקצה (נדרשת גרסה 1.0.1 כדי לבדוק).
  - המודל המדויק בתוך האפליקציה (נבדק רק בנפרד: עובד, אבל איטי מאוד במכשיר חלש).
- **הסוד היחיד בפרויקט:** מפתח החתימה, שנמצא רק במחשב שבו נבנתה האפליקציה, בתיקייה `petkol-keys` על שולחן העבודה. הוא לא נמצא ב-GitHub. בלי המפתח אפשר להמשיך לפתח, אבל עדכון שנחתם במפתח אחר לא יותקן מעל הגרסה הקיימת.

## מה חדש ב-1.1.0
- **הקלטה ארוכה עם תמלול ברקע** (`src/lib/speech/jobs.svelte.ts`, `src/components/LongRecBar.svelte`):
  - שירות נייטיב מקליט ברקע לקבצים של עד 28 שניות, ונחתך במקום שקט. הוא ממשיך גם כשהמסך כבוי.
  - תור עבודה מתמלל את הקטעים אחד אחד, בקצב רגוע. ההתקדמות נשמרת אחרי כל קטע, כך שאחרי קריסה או סגירה התמלול ממשיך מאותה נקודה.
  - התראה מראה את ההתקדמות.
  - בסוף ההקלטה הטקסט מסודר אוטומטית (הגדרה: "סידור אוטומטי בסוף הקלטה ארוכה").
  - ההכתבה המיידית נשארה בדיוק כמו שהייתה.
- **הגנה מקריסות** (`engine.svelte.ts`):
  - לפני כל קריאה לקוד נייטיב נשמר סימון ב-localStorage. אם האפליקציה קרסה באמצע הקריאה, הסימון נשאר, ובפתיחה הבאה האפליקציה עוברת לבד ל"מנוע בטוח": Ozen ב-WASM בתוך האפליקציה, עם אותם קבצי מודל.
  - בהגדרות אפשר לבחור מנוע (אוטומטי, מהיר, בטוח) ולהפעיל "עבודה רגועה" (2 מעבדים והפסקות קצרות).
- **סידור ועימוד טקסט** (`src/lib/tidy.ts`, `src/components/TidySheet.svelte`):
  - עובד בלי אינטרנט, לפי כללים: פיסוק, סימני שאלה, פסקאות, כותרות, רשימות, ציטוטים, הסרת "אממ" וחזרות, גרשיים ומקפים.
  - הדגשות חכמות, ו-4 סגנונות עימוד: כמו שהוא, מודרני, קלאסי, ספר.
  - נכנסים אליו מ"חדש" ← "סידור טקסט" (מדביקים טקסט ונוצרת הערה), או מתפריט ההערה ← "סידור הטקסט" (משפץ את ההערה הקיימת, ו"ביטול" מחזיר אותה).
- **על ה-Boox Go 6:** מעבד Qualcomm שמיני עד 2GHz, ‏2GB זיכרון, ‏Android 11, ומערכת שמקפיאה אפליקציות ברקע. לכן כדאי לאשר "לאפשר עבודה ברקע" בהגדרות ← הכתבה.

## מבנה כללי

| שכבה | טכנולוגיה | איפה |
|---|---|---|
| ממשק | Svelte 5 + TypeScript + Vite | `src/` |
| עורך טקסט | Tiptap 3 (ProseMirror) | `src/components/Editor.svelte` |
| אפליקציית אנדרואיד | Capacitor 8 (WebView) | `android/` |
| מודל רגיל (Ozen-v1) | ONNX Runtime Android (נייטיב). חישוב המאפיינים והפענוח ב-JS (Transformers.js) | `src/lib/speech/`, `android/app/src/main/java/app/petkol/notes/` |
| מודל מדויק (ivrit.ai) | whisper.cpp (JNI) | `android/app/src/main/cpp/` |
| אחסון | IndexedDB (ספריית idb), עם הצפנת AES-GCM כשיש סיסמה | `src/lib/db.ts`, `src/lib/crypto.ts`, `src/lib/store.svelte.ts` |

## קבצים חשובים

- `src/App.svelte`: ניווט בין המסכים, כפתור "חזרה" באנדרואיד, נעילה אוטומטית, באנר עדכון.
- `src/lib/store.svelte.ts`: כל הנתונים: תיקיות, הערות, סל מחזור, נעילה והצפנה, גיבוי.
- `src/lib/settings.svelte.ts`: כל ההגדרות וברירות המחדל.
- `src/lib/speech/engine.svelte.ts`: רשימת המודלים (כתובות הורדה, גדלים), הורדה, טעינה, תמלול ומילון תיקונים.
- `src/lib/speech/recorder.ts`: הקלטה מהמיקרופון ב-16kHz וחיתוך למשפטים לפי שקט.
- `src/lib/speech/ozen.worker.ts`: Web Worker שמחשב את המאפיינים (log-mel) ומפענח טוקנים לטקסט.
- `src/lib/native.ts`: החוזה מול הפלאגין הנייטיב `PetkolNative`.
- `src/lib/exporter.ts`: PDF, שיתוף וגיבוי.
- `src/lib/update.svelte.ts`: בדיקת עדכונים מול GitHub Releases, הורדה והתקנה של APK.
- `src/lib/fonts.svelte.ts`: גופנים מובנים (@fontsource) וגופנים שהמשתמש מוסיף.
- `src/app.css`: ערכות הצבעים (קרם, ספיה, כהה, דיו אלקטרוני), צבע מוביל, ורקעי מחברת.
- `scripts/make-icons.mjs`: מייצר את אייקון האפליקציה ומסכי הפתיחה מהלוגו.

## הכנת מחשב חדש (Windows)

1. **Node.js 22** ו-**Git**.
2. **JDK 21:** למשל Microsoft OpenJDK 21 מ-https://aka.ms/download-jdk/microsoft-jdk-21-windows-x64.zip. פורסים לתיקייה ומגדירים `JAVA_HOME`.
3. **Android SDK:** הדרך הקלה היא Android Studio. דרך מנהל ה-SDK מתקינים:
   - platform 36
   - build-tools 36
   - **NDK 27.1.12297006**
   - **CMake 3.22.1**
   - platform-tools
4. **whisper.cpp:** `git clone --branch v1.9.6 https://github.com/ggml-org/whisper.cpp`. רושמים את הנתיב ב-`android/local.properties`:
   ```
   sdk.dir=C\:/Users/<you>/AppData/Local/Android/Sdk
   whisper.dir=C:/path/to/whisper.cpp
   ```
5. **מפתח החתימה:** שמים את התיקייה `petkol-keys` (עם `petkol-release.jks` ו-`keystore.properties`) **ליד** תיקיית `petkol`, באותה תיקיית אם. אפשר גם להעתיק את `keystore.properties` לתוך `android/` ולתקן בו את `storeFile` לנתיב מלא.
6. מריצים `npm install`, ואז `npm run build:android`, ואז `cd android` ו-`.\gradlew.bat assembleRelease -Pabis=arm64-v8a`.

## הרצה במחשב (לפיתוח הממשק)

```powershell
cd C:\Users\770tz\Desktop\petkol
npm install
npm run dev
```

בדפדפן המודל הרגיל רץ ב-WASM (איטי, אבל מספיק לבדיקה), והמודל המדויק לא זמין.

## בניית APK

דרישות: JDK 21 (נמצא ב-`C:\Users\770tz\tools\jdk-21.0.13.1+2`) ו-Android SDK עם NDK 27 (ב-`C:\Users\770tz\AppData\Local\Android\Sdk`).

```powershell
cd C:\Users\770tz\Desktop\petkol
npm run build
npx cap sync android
$env:JAVA_HOME = "C:\Users\770tz\tools\jdk-21.0.13.1+2"
cd android
.\gradlew.bat assembleRelease -Pabis=arm64-v8a
```

ה-APK נוצר ב-`android/app/build/outputs/apk/release/app-release.apk`.

- `-Pabis=arm64-v8a` בונה רק למעבדי 64 ביט (Boox וכמעט כל טלפון מהשנים האחרונות), ו-APK יוצא קטן בהרבה. בלי הפרמטר נבנות גם הגרסאות armeabi-v7a (טלפונים ישנים מאוד) ו-x86_64 (לאמולטור), וה-APK כבד בהרבה בגלל ONNX Runtime.
- הבנייה הנייטיב הראשונה (whisper.cpp) לוקחת כ-10–15 דקות, ואחר כך שניות.
- whisper.cpp נמצא ב-`C:\Users\770tz\tools\whisper.cpp` (גרסה v1.9.6). אפשר לשנות את הנתיב עם `whisper.dir=` ב-`android/local.properties`.
- פיתוח ובדיקה על האמולטור: `.\gradlew.bat assembleDebug`, מתקינים עם `adb install -r`, ומתחברים ל-WebView דרך `chrome://inspect`.

## דברים שכדאי לדעת
- **transformers.js 4.3:** כשנותנים לו נתיב מקומי בצורת כתובת https, הוא לא מזהה שהקבצים קיימים. לכן ב-`ozen.worker.ts` התיקייה במכשיר מוגדרת בתור `remoteHost`. בפועל שום בקשה לא יוצאת מהמכשיר.
- **הפלאגין הנייטיב:** whisper ו-Ozen רצים כל אחד על thread משלו, ושניהם יכולים לרוץ באותו זמן. במכשיר עם 2GB זיכרון אסור לטעון את שניהם יחד, ו-`engine.prepare()` דואג לפרוק את השני.
- **המודל המדויק** צריך בערך 750MB זיכרון, ובמעבד חלש הוא איטי מאוד: דקות לכל משפט.

### מפתח החתימה: חשוב מאוד
- המפתח נמצא ב-`C:\Users\770tz\Desktop\petkol-keys\` (`petkol-release.jks` ו-`keystore.properties`). הוא **לא** נמצא ב-GitHub.
- **שמרו עליו גיבוי.** עדכון עובד רק כשהגרסה החדשה חתומה באותו מפתח. אם המפתח אובד, אי אפשר לעדכן את האפליקציה אצל מי שכבר התקין אותה, וצריך להסיר ולהתקין מחדש (וההערות נמחקות, אלא אם שמרו גיבוי).

## פרסום גרסה חדשה (עדכון)

1. מעלים את המספר ב-`package.json` (למשל `1.0.1`), ואת `versionCode` ו-`versionName` ב-`android/app/build.gradle`.
2. בונים APK כמו למעלה.
3. יוצרים Release ב-GitHub עם תגית בפורמט `v1.0.1` ומצרפים את ה-APK:

```powershell
gh release create v1.0.1 android/app/build/outputs/apk/release/app-release.apk#petkol-1.0.1.apk --repo tzviki1304/petkol --title "פתקול 1.0.1" --notes "מה חדש..."
```

4. האפליקציה בודקת את ה-Release האחרון (`releases/latest`). אם הגרסה חדשה יותר, היא מציעה להוריד ולהתקין. ההערות נשמרות.

## המודלים

| מודל | קבצים | מקור | מראה (גיבוי) |
|---|---|---|---|
| Ozen-v1 (רגיל) | `config.json`, `generation_config.json`, `preprocessor_config.json`, `tokenizer.json`, `tokenizer_config.json`, `onnx/encoder_model.onnx` (fp32, 158MB), `onnx/decoder_model_merged.onnx` (85MB) | Hugging Face `itayinbar/Ozen-v1` | Release `models-v1` בריפו, בשמות `ozen-v1__<path with __>` |
| ivrit.ai turbo (מדויק) | `ggml-ivrit-turbo-q5_0.bin` | הוקטן (quantize q5_0) מ-`ivrit-ai/whisper-large-v3-turbo-ggml` עם whisper.cpp | Release `models-v1` |

הקבצים נשמרים במכשיר בתיקייה `files/models/` של האפליקציה.

## רעיונות להמשך
- מקש חומרה (כפתורי עמוד או עוצמת שמע) להפעלת הכתבה.
- סנכרון לענן או לגוגל דרייב.
- וידג'ט למסך הבית ל"הערה מהירה בקול".
- תצוגת גלריה (כרטיסים) לתיקיות.
