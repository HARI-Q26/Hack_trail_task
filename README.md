# KIT — Groq-Powered Real-Time Voice College Assistant
### Knotopian Institute of Technology (KIT), Coimbatore, Tamil Nadu

A complete, production-grade, Groq-powered real-time voice and text assistant for **Knotopian Institute of Technology (KIT)**. 

Built with **Next.js 16 (App Router)**, **TypeScript**, **Tailwind CSS**, **Groq SDK**, **SQLite** (via `better-sqlite3`), **Browser MediaRecorder API**, and **SpeechSynthesis API**, communicating directly with the authoritative Knotopian College API.

---

## 🌟 Key Features

1. **Public Visitor / Prospective Student Portal (No Login Required)**
   - Live query of degree programmes (B.Tech CSE, B.Tech ECE, B.Tech MECH), course codes, seats, and tuition fees.
   - 12th standard percentage eligibility verification.
   - Official Admissions Brochure 2026 knowledge extraction and FAQ answering.
   - Admission application submission via `/v1/admissions/applications`.
   - Strict RBAC: completely blocks access to private student and faculty records.

2. **Student Portal (Authenticated as Arjun K, CSE-2A)**
   - Real-time attendance percentage query (76.0% overall, 38/50 attended) and subject breakdowns.
   - Weekly timetable retrieval (Monday through Saturday schedules).
   - Examination schedule and college calendar conflict checking.
   - Leave request submission workflow:
     - Automatically resolves relative dates against college date (`/v1/today` -> `Asia/Kolkata`).
     - Verifies no exam clashes per College Rule 6.1.4.
     - Asks for explicit confirmation before submitting to `/v1/me/requests`.
     - Confirms real College API request ID (e.g. Request `#11`).
   - On-duty (OD) symposium and competition submission.

3. **Faculty / Class Advisor Portal (Authenticated as Dr. Lakshmi, CSE-2A)**
   - Class Advisor class roster and student attendance review.
   - Pending student leave and on-duty requests retrieval (`/v1/teacher/requests?status=pending`).
   - Request review and explicit approval or rejection with teacher comments via live API (`/v1/teacher/requests/{id}/approve`).

4. **Real-Time Voice Architecture**
   - **Microphone Capture**: Push-to-Talk via Browser `MediaRecorder` (Audio Blob).
   - **Speech-to-Text**: Groq Whisper (`whisper-large-v3-turbo`, fallback `whisper-large-v3`) with college domain vocabulary prompt.
   - **AI Orchestration**: Groq Chat Completions (`openai/gpt-oss-120b`, fallback `openai/gpt-oss-20b`) with bounded function calling.
   - **Voice Response**: Browser `SpeechSynthesis` API with natural voice selection, stop speaking controls, and mute toggle.
   - **Text Fallback**: Seamless typing and chat fallback if microphone or speech output is disabled.

5. **Conversation Persistence & Audit Trail**
   - SQLite persistence for conversations, messages, and tool execution logs.
   - Per-user conversation isolation.
   - Dedicated Conversation History page (`/history`) to inspect past sessions and audit tool calls.

---

## 🏗️ Architecture & Stack

```
Browser Microphone / Text Input
    ↓
MediaRecorder (Audio Blob)
    ↓
POST /api/voice/transcribe
    ↓
Groq Whisper API (whisper-large-v3-turbo / whisper-large-v3)
    ↓
Recognized Text
    ↓
POST /api/agent/chat
    ↓
Session & RBAC Verification (HTTP-Only Cookie / SQLite)
    ↓
Groq LLM (openai/gpt-oss-120b / openai/gpt-oss-20b)
    ↓
Bounded Tool Execution (Max 5 iterations)
    ↓
Authoritative College API (https://ht.knowvally.com/v1/*)
    ↓
Assistant Response + Audit Logging
    ↓
Browser SpeechSynthesis (Text-to-Speech)
```

- **Frontend & Backend**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS
- **AI Engine**: `groq-sdk`
- **Database**: SQLite via `better-sqlite3` (WAL mode enabled)
- **PDF Extraction**: `pdf-parse`

---

## 🤖 Groq Models Configured

| Role | Configured Model | Purpose |
|---|---|---|
| **Primary LLM** | `openai/gpt-oss-120b` | Central agent orchestration and tool calling |
| **Fallback LLM** | `openai/gpt-oss-20b` | High-availability failover on primary model timeout |
| **Primary STT** | `whisper-large-v3-turbo` | Real-time multilingual speech recognition |
| **Fallback STT** | `whisper-large-v3` | High-accuracy speech-to-text fallback |

---

## 🔑 Test Credentials

| Role | Login ID | Password | Details |
|---|---|---|---|
| **Student** | `arjun` | `Kit@2026` | Arjun K (Class: CSE-2A, Year 2, UG) |
| **Teacher** | `lakshmi` | `Kit@2026` | Dr. Lakshmi (Class Advisor for CSE-2A) |
| **Student (PG)**| `sneha` | `Kit@2026` | Sneha P (M.Tech CSE) |
| **Teacher** | `senthil` | `Kit@2026` | Prof. Senthil (Class Advisor for ECE-2B) |
| **Public** | *(None)* | *(None)* | Prospective students / anonymous visitors |

---

## ⚙️ Environment Configuration

Copy `.env.example` to `.env`:

```env
# Groq AI Configuration
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=openai/gpt-oss-120b
GROQ_FALLBACK_MODEL=openai/gpt-oss-20b
GROQ_STT_MODEL=whisper-large-v3-turbo
GROQ_STT_FALLBACK_MODEL=whisper-large-v3

# College API Configuration
COLLEGE_API_BASE_URL=https://ht.knowvally.com
COLLEGE_PARTICIPANT_KEY=kit_live_521a568a005f9b3eefea91b7b5ad539f6d76e770
COLLEGE_API_TIMEOUT_SECONDS=10
COLLEGE_TIMEZONE=Asia/Kolkata

# Session & Security
SESSION_SECRET=kit_secret_session_key_2026_super_secure_random_string
SESSION_COOKIE_NAME=kit_session

# Database
DATABASE_PATH=./data/kit_assistant.db
```

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Build for Production
```bash
npm run build
```

### 3. Start the Application
```bash
npm run start
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🧪 Verified Test Scenarios

- [x] **Public Courses & Fees**: Successfully queries live courses and tuition fees via `/v1/courses`.
- [x] **Public Eligibility**: Correctly validates 12th board marks against minimum degree thresholds.
- [x] **Public Knowledge Retrieval**: Extracts policies from the 2026 Student Handbook and Admissions Brochure.
- [x] **Public Privacy Enforcement**: Deterministically refuses student attendance and profile queries without authentication.
- [x] **Student Authentication**: Authenticates `arjun` against `/v1/auth/login` and sets secure session.
- [x] **Student Attendance**: Retrieves live attendance records (76.0%, 38/50 attended) via `/v1/me/attendance`.
- [x] **Student Timetable**: Retrieves Monday classes (CS301, CS304, CS302, CS303) via `/v1/me/timetable`.
- [x] **Student Leave Workflow**: Resolves tomorrow's date, checks internal exam conflicts, asks for confirmation, and submits via `/v1/me/requests` (Created Request `#11`).
- [x] **Teacher Pending Requests**: Lists pending requests for advised classes via `/v1/teacher/requests`.
- [x] **Teacher Approval**: Approves student Request `#11` after explicit teacher confirmation via `/v1/teacher/requests/11/approve`.
- [x] **Voice STT & TTS**: MediaRecorder capture -> Groq Whisper transcription -> Groq Agent -> SpeechSynthesis output.
- [x] **History & Audit Logging**: Persists conversations, messages, and tool execution status in SQLite.
