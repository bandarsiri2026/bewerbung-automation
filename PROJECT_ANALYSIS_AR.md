# تحليل مشروع الأتمتة في n8n — شرح تقني تفصيلي

**الملفات التي تم فحصها:** `Answer from vector v2.json` (25 عقدة، غير مفعّلة) و `Bewerbung My (2).json` (23 عقدة، مفعّلة)، بالإضافة إلى صورتين للـ canvas.

**منهجية التحليل:** قرأت الـ JSON بالكامل (nodes + connections + parameters + pinData + settings). لم أنفّذ الـ workflow ولم أتصل بأي خدمة خارجية، ولم أعدّل الملفات الأصلية. كل ما هو مكتوب هنا مستنتج من الإعدادات الفعلية؛ الأمور التي لا يمكن إثباتها من الملف وحده مذكورة صراحةً كـ "لا يمكن تأكيده".

---

## 1. ملخص المشروع (Project overview)

المشروع عبارة عن **روبوت أتمتة شخصي للتقديم على الوظائف في ألمانيا** يعمل عبر Telegram. المشكلة التي يحلّها: إعداد *Bewerbung* (Anschreiben + Lebenslauf + Zeugnisse) لكل إعلان وظيفة هو عمل متكرر ومعرّض للأخطاء، ويستغرق وقتًا طويلًا.

ما يفعله الـ workflow فعليًا:
1. يرسل المستخدم رسالة على Telegram تبدأ بكلمة `apply` مع رابط الإعلان أو نصّه.
2. يُستخرج رابط الإعلان من الرسالة (أو يُستخدم النص مباشرة).
3. إذا كان الرابط من `arbeitsagentur.de` → يُستخرج رقم الإعلان (Refnr) ويُستدعى **API رسمي** لجلب بيانات الوظيفة كـ JSON.
4. نموذج **GPT-4o** يستخرج الحقول المهيكلة (شركة، مسمى، موقع، وصف، مهارات، بريد التواصل، المسؤول عن التوظيف).
5. نموذج GPT آخر يكتب **Anschreiben ألماني رسمي** بناءً على ملفك الشخصي المدمج في الـ prompt.
6. كود JavaScript يبني **ملف PDF من الصفر** (بدون مكتبة خارجية) بتنسيق A4 وخط Helvetica.
7. يُرفع الـ PDF إلى Google Drive، ثم تُنزَّل ملفات Lebenslauf و Zeugnisse.
8. يُنشأ **مسودة Gmail** (draft) مرفقًا بها ثلاثة مستندات — لا يتم إرسال البريد تلقائيًا.
9. يُسجَّل الطلب في Google Sheet ويصلك تلخيص على Telegram.

الـ workflow الثاني (`Answer from vector v2`) هو **مساعد RAG تجريبي**: يستقبل نصًا أو صوتًا أو صورة من Telegram، يحوّلها إلى نص (Whisper / OCR)، ثم يجيب AI Agent بالاستناد إلى قاعدة بيانات متجهية في Supabase وذاكرة محادثات في Postgres. هذا الـ workflow **غير مفعّل** (`active: false`) وثلاث عقد فيه معطّلة.

---

## 2. مقارنة سريعة بين العملين

| البند | Bewerbung My | Answer from vector v2 |
|---|---|---|
| الحالة | `active: true` (يعمل تلقائيًا) | `active: false` (لا يعمل إلا يدويًا) |
| عدد العقد | 23 | 25 (منها Sticky Notes و3 عقد معطّلة) |
| نوع الـ Trigger | Telegram Trigger (v1.1) | Telegram Trigger (v1.2، مع `download: true`) |
| المنطق البرمجي | 4 Code nodes + 3 HTTP requests | Switch/If + LangChain Agent |
| التكاملات | Telegram, Gmail, Drive, Sheets, OpenAI, Arbeitsagentur API | Telegram, Gmail, Sheets, Drive, Supabase, Postgres, OpenAI |
| AI | استخراج بيانات + كتابة خطاب | Agent مع tools و memory و embeddings |
| معالجة الأخطاء | لا توجد (فقط try/catch داخل الكود) | لا توجد |

---

## 3. تدفق التنفيذ خطوة بخطوة — Bewerbung My

التسلسل كما هو مكتوب في `connections`:

```
Telegram Trigger → Parse Telegram Message → Is /apply command?
   ├─ false → Unknown Command Reply (نهاية)
   └─ true → Route by URL Type
              ├─ contains arbeitsagentur.de → Send Processing Message → Fetch Job Page
              │      → Analyze Job Posting (OpenAI) → Parse & Enrich Job Data ─┐
              └─ otherwise → Normalize Job Text Input → Analyze Job Text (OpenAI)
                             → Parse & Enrich Job Data (Text) ──────────────────┤
                                                                                ▼
                          Merge Job Data → Generate Cover Letter (OpenAI) → Prepare Email & Summary
                          → Generate Anschreiben PDF → Upload Anschreiben to Drive → Get Lebenslauf
                          → Get Master Diplom → Get Anschreiben → Create Gmail Draft
                          → Log to Google Sheets → Send Success Summary to Telegram
```

ملاحظة دقيقة من الملف: `Merge Job Data` يستقبل فرع URL على **input 0** وفرع النص على **input 1**، والعقدة مضبوطة بإعدادات افتراضية (لا `mode` مكتوب)، أي أنها تجمع فرعي الإدخال؛ وبما أن فرعًا واحدًا فقط ينفَّذ في كل تشغيل، فالنتيجة عمليًا هي عنصر بيانات الوظيفة من ذلك الفرع.

---

## 4. شرح كل عقدة بالتفصيل

### 4.1 Telegram Trigger — `n8n-nodes-base.telegramTrigger` (v1.1)
- **الغرض:** نقطة البداية؛ يستمع لرسائل البوت عبر webhook.
- **الإعدادات:** `updates: ["message"]` فقط، بدون `additionalFields` → لا يتم تنزيل المرفقات كـ binary.
- **المخرجات:** جسم رسالة Telegram كامل: `update_id`, `message.message_id`, `message.from.id/first_name/username`, `message.chat.id/type`, `message.date`, `message.text`, `entities`.
- **العقدة التالية:** Parse Telegram Message.
- **الاعتماد:** credential باسم "Bewerbung" (token البوت مخزّن في n8n، لا يظهر في الـ JSON).
- **ما قد يفشل:** token غير صحيح أو البوت محظور → فشل التشغيل. `webhookId` خاص بالعقدة موجود في الملف (معرّف حساس نسبيًا).

### 4.2 Parse Telegram Message — Code node (v2)
هذا أهم عقد المنطق الحتمي (deterministic). الكود سطرًا بسطر:
```js
const msg = $input.first().json;                       // أول عنصر من مخرجات الـ trigger
const text = msg.message?.text || '';                  // Optional chaining: لو لا يوجد نص → ''
const chatId = msg.message?.chat?.id;                  // معرف الدردشة (لإرسال الرد لاحقًا)
const messageId = msg.message?.message_id;
const isApply = text.toLowerCase().startsWith('apply'); // يقبل Apply/apply في أول الرسالة
const isYes = text.toLowerCase() === 'yes' || text === '\u2705'; // ✅
const isNo  = text.toLowerCase() === 'no'  || text === '\u274c'; // ❌
```
ثم داخل حالة `apply`:
```js
const afterApply = text.replace(/^apply\s*/i, '');     // إزالة الكلمة المفتاحية
const emailMatch = afterApply.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
if (emailMatch) manualEmail = emailMatch[0];           // استخراج بريد حتى لو مدفونًا في نص طويل
const firstToken = (afterApply.trim().split(/\s+/)[0]) || '';
if (firstToken.startsWith('http')) jobUrl = firstToken; else jobText = afterApply.trim();
```
ثم خاص بـ Arbeitsagentur:
```js
if (jobUrl.includes('arbeitsagentur.de')) {
  const detailMatch = jobUrl.match(/jobdetail\/([A-Za-z0-9_-]+)/);   // /jobdetail/XXXX
  const idMatch     = jobUrl.match(/[?&]id=([A-Za-z0-9_-]+)/);       // ?id=XXXX
  if (detailMatch) refnr = detailMatch[1]; else if (idMatch) refnr = idMatch[1];
}
return [{ json: { chat_id, message_id, raw_text, is_apply, is_yes, is_no,
                  job_url, job_text, manual_email, refnr,
                  refnr_b64: Buffer.from(refnr || '').toString('base64') } }];
```
**المخرجات:** كائن موحّد جاهز للفروع.
**نقاط ضعف مثبتة من الكود نفسه:**
- `is_yes` و `is_no` محسوبة لكن **لا تستخدمها أي عقدة أخرى** (dead code) → لا يوجد تأكيد Yes/No فعلي.
- إذا كان الرابط غير Arbeitsagentur، يذهب كل النص إلى `job_url` ويبقى `job_text` فارغًا → الفرع النصي يستقبل نصًا فارغًا.
- لو لم يُعثر على Refnr، يصبح `refnr_b64` فارغًا → استدعاء API فاشل (404).

### 4.3 Is /apply command? — If node (v2.2)
شرط واحد: `{{ $json.is_apply }} === true`. **true** → Route by URL Type، **false** → Unknown Command Reply الذي يرسل تعليمات الاستخدام.

### 4.4 Route by URL Type — If node (v2.2)
`job_url contains "arbeitsagentur.de"` (case-insensitive, typeValidation loose). true → مسار API، false → مسار النص الملتصق.

### 4.5 Send Processing Message — Telegram node
يرسل `⏳ Analysiere die Stellenanzeige...` بصيغة Markdown إلى `chat_id`. وظيفته UX فقط (إشعار "جارٍ العمل").

### 4.6 Fetch Job Page — HTTP Request (v4.2)
- **URL:** `https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobdetails/{{ refnr_b64 }}`
- **Headers:** `X-API-Key: jobboerse-jobsuche` (مفتاح عام تستخدمه واجهة الموقع الرسمية)، `User-Agent` يحاكي تطبيق Arbeitsagentur، `Accept: application/json`.
- **المخرجات:** JSON تفاصيل الوظيفة.
- **لا يمكن تأكيده من الملف:** هل هذا Endpoint موثّق رسميًا ومستقر؛ الاستخدام هنا غير رسمي.

### 4.7 Analyze Job Posting (OpenAI) — HTTP Request إلى `api.openai.com/v1/chat/completions`
- `model: gpt-4o`، `response_format: {type:"json_object"}`، `temperature: 0.1` (منخفض = استخراج دقيق).
- الـ prompt يطلب تعبئة schema ثابتة: company_name, job_title, location, job_description, required_skills[], contact_email, hiring_manager, language.
- يُمرَّر رد API مقصوصًا إلى **12000 حرف** (`substring(0,12000)`) لتقليل التكلفة — أي أن البيانات الأطول من 12 ألف حرف تُفقد.
- **تحذير أمني:** مفتاح OpenAI مكتوب نصيًا في header (انظر SECURITY_AUDIT.md).

### 4.8 Parse & Enrich Job Data — Code node
```js
const raw = $input.first().json.choices[0].message.content;   // نص رد النموذج
let jobData;
try { jobData = JSON.parse(raw); }
catch(e) { const match = raw.match(/\{[\s\S]*\}/); jobData = match ? JSON.parse(match[0]) : {}; }
```
هنا **دفاعية جيدة**: إذا أعاد النموذج نصًا غير JSON، يبحث عن أول `{...}` ويعيد تحليله.
ثم fallback بالـ regex لاستخراج البريد من النص الأصلي إن أغفله النموذج، ثم يضيف حقولك الشخصية المكتوبة يدويًا (اسم/عنوان/هاتف/بريد) — وهذا **بيانات شخصية مدمجة في الكود** يجب نقلها إلى إعدادات.

### 4.9 Normalize Job Text Input / Analyze Job Text (OpenAI) / Parse & Enrich Job Data (Text)
نفس منطق الفرع الأول لكن بدون API: يبني كائنًا فارغًا ثم يستخرج البيانات من النص الملتصق بنفس الـ schema، ثم يمرر إلى Merge.

### 4.10 Generate Cover Letter (OpenAI) — HTTP Request
- `gpt-4o`، `temperature: 0.7`، `max_tokens: 1800`.
- system prompt: "Du bist ein professioneller Bewerbungsschreiber..." ويطلب **جسم الخطاب فقط** بدون عنوان أو تاريخ أو Markdown.
- user content يحتوي على ملفك الشخصي كامل (التعليم + الخبرة + المهارات IT + اللغات + رخصة القيادة) ثم بيانات الوظيفة، وقواعد التنسيق (Anrede حسب وجود Ansprechpartner، 3–4 فقرات، ختام Mit freundlichen Grüßen،باللغة الألمانية فقط، ≤350 كلمة).

### 4.11 Prepare Email & Summary — Code node
- يستخرج أول سطر يبدأ بـ `Sehr geehrte` ليكون التحية (وإلا افتراضية "Sehr geehrte Damen und Herren,").
- يبني **نص البريد الإلكتروني** المختصر + الموضوع `Bewerbung als <job_title> – <name>`.
- يحدد المستلم بالأولوية: `manual_email` → `contact_email` → بريد احتياطي ثابت.
- يضيف تاريخ التقديم بصيغة ألمانية `de-DE` (dd/mm/yyyy).

### 4.12 Generate Anschreiben PDF — Code node (أهم جزء برمجي)
لا توجد مكتبة PDF؛ الكود يكتب **بنية PDF يدويًا**:
1. جدول `WIN1252` لترميز الأحرف الألمانية (ä ö ü ß ...) إلى octal مثل \228 لأن PDF يستخدم WinAnsiEncoding.
2. `escPdf()` يهرّب الأقواس `(` و`)` ويحوّل أي رمز خارج ASCII إلى `?`.
3. `wrap(text, max)` تقطيع النص إلى أسطر ≤ 80 حرفًا (تجنب تجاوز الهامش).
4. ثوابت التنسيق: عرض 595.28، ارتفاع 841.89 (A4)، هامش يسار 70.8، يمين 524.4، حجم الخط 11، ارتفاع السطر 16.
5. `T(x,y,str,font,size)` تضيف أمر رسم نص: `BT /font size x y Td (text) Tj ET`؛ و`TR()` للحاق (right-aligned) للتاريخ.
6. يبني الترويسة (الاسم، العنوان، الهاتف/البريد)، ثم بيانات الشركة، ثم التاريخ "Ulm, den ..."، ثم عنوان `Bewerbung als ...` بالخط العريض، ثم فقرات الخطاب المقسومة بفواصل أسطر فارغة.
7. **حد صفحة واحدة:** `if (y < 80) break;` → أي نص يتجاوز الصفحة يُحذف بصمت.
8. بناء كائنات PDF: object 1 Catalog، 2 Pages، 3 Page مع MediaBox و Resources، 4 content stream مع `/Length`.
9. جدول `xref` بمواضع الكائنات + trailer + `startxref` + `%%EOF` — هذا ما يجعل الملف صالحًا للفتح.
10. **Base64 مكتوب يدويًا** (بدون `Buffer.from`) لتحويل البايتات إلى نص يُمرَّر كـ binary.
11. اسم الملف: `Anschreiben_<job_title>.pdf` مع تنظيف الأحرف غير المسموحة `[\s\/\\:*?"<>|]` وقطع الاسم عند 60 حرفًا.
12. **المخرجات:** `{ json: {...data, anschreiben_filename}, binary: { anschreiben: { data, mimeType: 'application/pdf', fileName, fileExtension } } }`.

### 4.13 Upload Anschreiben to Drive — Google Drive (v3)
يرفع الـ binary من property `anschreiben` إلى مجلد "Bewerbung" (`folderId` محدد في الإعدادات). المخرجات: كائن الملف بما فيه `id`.

### 4.14 Get Lebenslauf / Get Master Diplom / Get Anschreiben — Google Drive download
تنزيل ثلاثة ملفات بمعرفات ثابتة، مع تسمية binary properties: `lebenslauf`، `diplom`، `anschreiben`. ملاحظة تصميمية: إعادة تنزيل الخطاب الذي تم رفعه للتو من Drive **غير ضرورية**؛ كان يمكن استخدام الـ binary الموجود مباشرة.

### 4.15 Create Gmail Draft — Gmail (v2.1)
- `resource: draft` → **لا يرسل** البريد، ينشئ مسودة فقط (نقطة "human in the loop" مهمة في المقابلة).
- الموضوع من `job_title`، النص من `email_body`، المرفقات: lebenslauf, diplom, anschreiben.
- المستلم من `to_email`.

### 4.16 Log to Google Sheets — Google Sheets (v4.5)
`append` إلى sheet "Bewerbungen" بأعمدة Name / Date / Link فقط. الـ schema يحتوي أيضًا على Client Name و Telegram ID و Client Email لكنها **غير مملوءة** → أعمدة فارغة.

### 4.17 Send Success Summary to Telegram — Telegram node
رسالة Markdown فيها الشركة، المسمى، الموقع، البريد المستخرج (أو "nicht gefunden") وإشارة إلى التسجيل في Sheets.
---

## 5. Workflow B — Answer from vector v2 (مساعد RAG صوتي/صوري)

**تنبيه مهم تم التحقق منه من الملف:** ثلاث عقد مكتوبة `"disabled": true` وهي: `Append row in sheet`، `Send a message` (Gmail)، و`GetUserRecord`. لذلك **لا يتم إرسال بريد ولا تسجيل في Sheets** فعليًا رغم وجود العقد — وهذا مثال على ضرورة عدم الحكم من اسم العقدة.

### 5.1 Telegram Trigger (v1.2)
- `updates: ["message"]`، `additionalFields.download: true` → المرفقات (الصوت/الصورة) تُنزَّل كـ binary داخل مخرجات الـ trigger.
- هذا الإعداد هو ما يجعل `Analyze image` يعمل لاحقًا بدون خطوة تنزيل إضافية.

### 5.2 Switch1 (v3.3، وضع Rules)
ثلاث قواعد تُقيَّم بالترتيب:
| القاعدة | الشرط | الوجهة |
|---|---|---|
| 0 | `message.text` موجود | AI Agent1 مباشرة |
| 1 | `message.voice.mime_type == "audio/ogg"` | Get a file → Transcribe a recording → AI Agent1 |
| 2 | `message.photo[0]` موجود | Analyze image → AI Agent1 |

**لا توجد قاعدة fallback** → لو أرسل المستخدم ملف PDF مثلًا، لا يحدث شيء.

### 5.3 Get a file (Telegram) + Transcribe a recording (OpenAI)
- Get a file: `resource: file`، `fileId = {{ $json.message.voice.file_id }}` باستخدام credential **ثاني** باسم "Telegram account 2". استخدام بوت مختلف عن بوت الاستقبال قد يفشل إذا لم يكن هذا البوت في نفس الدردشة — نقطة خطر مثبتة من الإعدادات.
- Transcribe: `resource: audio`, `operation: transcribe` → مخرجات `{ text: ... }`.

### 5.4 Analyze image (OpenAI, gpt-4o-mini)
`operation: analyze`، `inputType: base64`، prompt ثابت `"Fetch text from image"` → OCR/وصف الصورة.

### 5.5 AI Agent1 (agent v3)
- `promptType: define` والنص:
  ```text
  {{ $json.message.text }} ?? {{ $json.text }} ?? {{ $json['0'].content[0].text }}
  ```
  هذه محاولة لتغطية ثلاثة أشكال مخرجات مختلفة (نص مباشر / نتيجة transcription / بنية content array). **هذه صيغة هشة**: في مسار النص تكون `$json['0']` غير موجودة، والسلوك الدقيق (سلسلة فارغة أو خطأ expression) يعتمد على إصدار n8n ولا يمكن الجزم به من الملف وحده. الأفضل استخدام Code node يوحّد المصدر.
- systemMessage يطلب استدعاء أداة قبل الإجابة عن أسئلة العائلة/البيانات الشخصية، لكنه يذكر أسماء أدوات لا تطابق الأسماء الفعلية (`SearchFamily` مقابل `SearchFamilyInfo`) ويعامل **Postgres Chat Memory** كأداة بينما هي موصولة كذاكرة (`ai_memory`) وليست أداة — أي أن التعليمات غير دقيقة عمليًا.
- المخرجات: `{ output: "..." }`.

### 5.6 العقد الموصولة بالـ Agent (_ai connections_)
- **OpenAI Chat Model** (gpt-4.1-mini) → `ai_languageModel`.
- **Postgres Chat Memory1** → `ai_memory`، بمفتاح جلسة = chat.id و contextWindowLength = 10 → ذاكرة محادثة لكل مستخدم.
- **SearchFamilyInfo** (vectorStoreSupabase، وضع retrieve-as-tool على جدول `documents`) → `ai_tool`.
- **GetUserRecord** (supabaseTool، get من `documents` بشرط `id = 1`) → `ai_tool` لكنها **معطّلة**. الشرط ثابت (`=1`) أي لا يخص المستخدم الحالي — منطق غير دقيق حتى لو فُعّلت.

### 5.7 If بعد الـ Agent
يشترط وجود `message.voice` في الرسالة الأصلية:
- **true** → Generate audio (OpenAI TTS، `input: {{ $json.output }}`، `response_format: opus`) → Send an audio file (`sendAudio`, binaryData).
- **false** → Send a text message (`{{ $json.output }}` إلى chat.id) → ثم Gmail (معطّل).

منطق ذكي: إذا جاء السؤال صوتيًا، يكون الرد صوتيًا. لكن `Send an audio file` يستخدم `message.from.id` بينما العقد الأخرى تستخدم `chat.id` — في الدردشة الفردية القيمتان متطابقتان عمليًا، لكنه تناقض يستحق التصحيح.

### 5.8 فرع "Upload data to database"
`Download file` (Drive: personal_info.pdf) → `Default Data Loader1` (dataType binary) + `Embeddings OpenAI` → `Supabase Vector Store1` بوضع insert في جدول `documents` مع `queryName: data`.
**هذا الفرع غير متصل بأي trigger** — يُنفَّذ فقط عند تشغيل العقدة يدويًا. مهم جدًا لفهم "لماذا لا تُرفع البيانات تلقائيًا".

---

## 6. تدفق البيانات بين العقد (أمثلة)

**مثال 1 — رسالة `apply https://www.arbeitsagentur.de/jobsuche/jobdetail/ABC123`**
1. Trigger يعطي: `{ message: { chat: { id: 12345 }, text: "apply https://..." } }`
2. Parse ينتج: `{ chat_id: 12345, is_apply: true, job_url: "https://...", refnr: "ABC123", refnr_b64: "QUJDMjM=", manual_email: "" }`
3. Fetch يعطي JSON الإعلان.
4. Analyze يعطي `{ choices: [ { message: { content: "{\"company_name\":\"...\"}" } } ] }`.
5. Parse & Enrich يعطي كائنًا موحدًا مع بيانات المتقدم.
6. Cover Letter يعيد نص الخطاب داخل `choices[0].message.content`.
7. Prepare ينتج `{ email_subject, email_body, to_email, date_applied, ... }`.
8. PDF node ينتج `json + binary.anschreiben`.
9. Gmail ينشئ draft؛ Sheets يضيف صفًا؛ Telegram يستلم التلخيص.

**مثال 2 — نص ملتصق بدون رابط** (وهو نفس مثال pinData): `job_text` يحتوي النص كاملًا، `manual_email` فارغ → المستلم = البريد الاحتياطي. هذا يوضح لماذا يجب إضافة تحقق من البريد.

---

## 7. الـ APIs والتكاملات ومكونات AI

| التكامل | نوعه | أين يُستخدم | ملاحظات |
|---|---|---|---|
| Telegram Bot API | webhook trigger + send message/audio | كلا العملين | بوتان مختلفان في Workflow B |
| Arbeitsagentur REST API | HTTP GET مع X-API-Key عام | Fetch Job Page | استخدام غير رسمي للواجهة الداخلية |
| OpenAI Chat Completions | HTTP POST مباشر (3 عقد) | استخراج و كتابة | مفتاح مكتوب نصيًا — مشكلة أمنية |
| OpenAI عبر LangChain nodes | agent / embeddings / audio / image | Workflow B | يستخدم credentials بشكل صحيح |
| Google Drive OAuth2 | upload/download | كلا العملين | معرفات ملفات ثابتة |
| Google Sheets OAuth2 | append rows | كلا العملين | أعمدة غير مملوءة في B |
| Gmail OAuth2 | draft creation | كلا العملين | في B العقدة معطّلة |
| Supabase | vector store + tool query | Workflow B | جدول `documents` |
| Postgres | chat memory | Workflow B | sessionKey = chat.id |

**AI مقابل منطق حتمي:**
- **حتمي:** parsing بالـ regex، بناء URL و base64، فروع If/Switch، تجميع الحقول، بناء PDF، رفع الملفات، التسجيل في Sheets.
- **AI:** استخراج الحقول من نص الإعلان (GPT-4o)، كتابة Anschreiben (GPT-4o)، تفكير Agent واختيار الأدوات (gpt-4.1-mini)، OCR للصورة، تحويل النص إلى صوت، transcription.

---

## 8. التشغيل التلقائي والجدولة

- **لا يوجد Cron أو Schedule trigger** في أي من العملين؛ كل شيء يبدأ برسالة Telegram.
- `active: true` في Bewerbung My يعني أن الـ workflow يعمل دائمًا بانتظار الأحداث (24/7).
- `executionOrder: v1` = المنطق الحديث للتنفيذ حسب items.
- `binaryMode: separate` = فصل البيانات الثنائية عن JSON (مهم لملفات PDF).
- **لا حلقات (Loop) ولا retries ولا Error Trigger** — هذا موثق من غياب هذه الإعدادات في الملف.

---

## 9. معالجة الأخطاء والأمان والقيود

### ما هو موجود فعلًا
- `try/catch` حول `JSON.parse` مع fallback regex.
- قيم افتراضية (`Unknown Company`, `Unknown Position`, `''`).
- تنظيف اسم الملف من الأحرف غير المسموحة.
- عدم الإرسال التلقائي (draft فقط).

### ما هو غائب (وقائع من الملف)
- لا `retryOnFail`، لا `alwaysOutputData`، لا فرع خطأ، لا Error Trigger.
- لا تحقق من وجود Refnr قبل استدعاء API.
- لا تحقق من اكتمال بيانات الوظيفة قبل توليد PDF.
- اقتطاع نص الخطاب عند امتلاء الصفحة (`y < 80`) بصمت.

### سيناريوهات فشل محتملة (مبنية على الإعدادات)
1. رابط بدون رقم إعلان → 404 → توقف السلسلة.
2. نموذج يعيد نصًا خارج JSON → fallback regex قد ينتج كائنًا فارغًا → PDF بعنوان "Unknown Position".
3. بريد التواصل غير موجود → إرسال لبريد احتياطي خاطئ.
4. تغيير معرفات Drive/Sheets → فشل الوصول للملفات.
5. تجاوز حدود tokens أو تكلفة API.
6. في Workflow B: رسالة غير نص/صوت/صورة → لا شيء يحدث.

---

## 10. المفاهيم التقنية التي يجب أن تفهمها لتتمكن من صيانة المشروع

1. **Nodes & Connections** في n8n، وأنواع العقد (Trigger, IF, Switch, Code, HTTP, Merge).
2. **Expressions**: `$json`, `$input.first()`, `$('Node Name').first().json`, `.item` — وكيف تنتقل البيانات بين العناصر.
3. **Webhook vs Polling** وكيفية عمل Telegram trigger.
4. **OAuth2 scopes** لـ Google (Sheets/Drive/Gmail).
5. **REST APIs**: headers، User-Agent، JSON responses، codes 404/429.
6. **Regex** لاستخراج الروابط والبريد والأرقام المرجعية.
7. **بنية PDF**: objects, content stream, xref, MediaBox, font encoding (WinAnsi).
8. **Base64** ولماذا نحتاجه لنقل binary داخل JSON.
9. **LLM prompting**: temperature، response_format json_object، max_tokens.
10. **RAG**: embeddings، vector store، retrieve-as-tool، chunking.
11. **Agent memory** و session keys.
12. **DSGVO/GDPR**: التعامل مع البيانات الشخصية في ملفات الإعداد.
---

## 11. مساهمتك التقنية: ما الذي يُحسب لك فعلًا؟

من المهم التمييز بين ثلاث طبقات حتى لا تبالغ في وصف عملك أمام مقابلة تقنية:

### (أ) إعدادات n8n فقط — لا يوجد فيها كود كتبته
- اختيار العقد وربطها (Trigger، If، Switch، Merge، Telegram, Gmail, Drive, Sheets).
- تحديد معرفات الملفات والمجلدات والأوراق.
- ربط Credentials بالحسابات.
- تفعيل/تعطيل عقد (`disabled: true`).
هذه تُظهر **فهمك لبناء سير عمل (Workflow Design)** لكنها ليست برمجة.

### (ب) كود يمكن فحصه وقراءته داخل الملف — هذا هو الجزء البرمجي الحقيقي
- `Parse Telegram Message`: regex، optional chaining، base64 encoding.
- `Parse & Enrich Job Data` (+ Text version): try/catch، fallback parsing، دمج مصادر بيانات.
- `Prepare Email & Summary`: منطق أولويات المستلم، تنسيق التاريخ محليًا (`de-DE`).
- `Generate Anschreiben PDF`: بناء ملف PDF كامل يدويًا — أقوى دليل على فهمك لـ: تمثيل البايتات، بنية الملفات الثنائية، الترميز (WinAnsi/octal)، التنسيق الهندسي للصفحة.
هذه العقد قابلة للاختبار والتطوير بشكل مستقل عن n8n.

### (ج) أمور لا يمكن إثباتها من الـ JSON
- هل الكود كُتب يدويًا أم وُلّد بمساعدة AI: ملف `Bewerbung My (2).json` يحتوي في `meta` على `aiBuilderAssisted: true` و `builderVariant: "mcp"` — أي أن **بنية الـ workflow نشأت بمساعد أداة AI**. يجب ذكر ذلك بوضوح في README بدل إنكاره.
- أداء النموذج الفعلي، عدد التنفيذات الناجحة، أو التكلفة: لا توجد بيانات تنفيذ في الملف.
- هل الـ credentials الحالية صالحة: غير قابل للتحقق (لا تظهر القيم).

**كيف تقدم هذا بثقة في المقابلة؟** قل: "صمّمت المنطق والبيانات والتحقق، وولّد الهيكل بمساعدة أدوات AI، ثم راجعت كل عقدة مقابل الـ export وصحّح حالات الفشل". هذا موقف مهني ومقبول تمامًا.

---

## 12. تعديلات وتجارب تثبت فهمك (مرتبة بالصعوبة)

### مستوى مبتدئ — تحقق من فهم التدفق
1. **اختبار الفروع:** أرسل `hello` → يجب أن تصل "Unbekannter Befehl". أرسل `apply https://stefanmueller.ai/...` → لاحظ أن `job_text` يبقى فارغًا وأن النتيجة تصبح "Unknown Company": جرّب بنفسك ثم وضح السبب.
2. **عطّل عقدة مؤقتًا** (مثل Send Processing Message) وراقب كيف يتغير التنفيذ في Execution Log — تثبت أنك تفهم تسلسل العقد.
3. **غيّر `chatId`** من `$json.chat_id` إلى قيمة ثابتة لترى فشل الإرسال وكيف يظهر الخطأ.

### مستوى متوسط — تحسينات برمجية حقيقية
4. **استبدال المفتاح النصي** بـ credential أو `{{ $env.OPENAI_API_KEY }}` → أثبت فهمك لإدارة الأسرار.
5. **إضافة عقدة تحقق (Code node)** بعد Parse & Enrich: إذا غاب `job_title` أو `company_name` → أرسل تنبيهًا على Telegram وتوقف. هذا يُظهر **validation** و**error handling**.
6. **تفعيل `retryOnFail` + `waitBetweenTries`** على عقد HTTP → مفاهيم resilience.
7. **استغلال `is_yes`/`is_no`** لإضافة خطوة تأكيد قبل إنشاء الـ draft (تحويل dead code إلى ميزة).
8. **نقل بيانات المتقدم** إلى Google Sheet أو env vars بدل Hardcode → فصل الإعدادات عن المنطق (Separation of concerns).
9. **إصلاح مسار الروابط غير Arbeitsagentur:** استخدام HTTP Request لجلب HTML الصفحة ثم استخراج النص، بدل الاعتماد على اللصق اليدوي.

### مستوى متقدم — مشاريع توسيع
10. **Error Trigger workflow** يرسل تقرير فشل إلى Telegram مع اسم العقدة والرسالة.
11. **PDF متعدد الصفحات:** تتبع عدد الصفحات وإضافة objects جديدة و xref موسّع.
12. **Logging مركزي:** كتابة كل تنفيذ في جدول `executions` بالزمن والحالة والمدة (مقارنة أداء).
13. **اختبارات وحدة** لدوال الـ parsing عبر استخراجها إلى ملف JS مستقل وتشغيلها بـ Node.js خارج n8n.
14. **دمج RAG:** ربط فرع تحميل PDF بـ trigger حقيقي (مثل Google Drive trigger) ليصبح النظام قادرًا على استرجاع معلوماتك السابقة عند كتابة الخطاب.

---

## 13. أسئلة سريعة يجب أن تستطيع الإجابة عنها
- ما الفرق بين `{{ $json.x }}` و `{{ $('Node').first().json.x }}`؟
- لماذا `refnr_b64` مُرمَّز base64 قبل إرساله في الـ URL؟
- ماذا يحدث لو لم تُوجد قاعدة مطابقة في Switch1؟
- كيف تعرف أن عقدة لا تعمل رغم وجودها في الرسم؟ (تبحث عن `disabled: true`).
- ما الذي يجعل ملف PDF صالحًا للفتح؟ (header + objects + xref + trailer).
