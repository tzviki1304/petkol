# פתקול: מסמך המשך עבודה

המסמך מסכם איך האפליקציה בנויה, איפה כל דבר נמצא, ואיך ממשיכים לפתח, בונים ומפרסמים גרסה.

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
