# KIT — Real-Time Voice College Assistant
### Knotopian Institute of Technology (KIT), Coimbatore, Tamil Nadu

A complete, production-grade, real-time voice and text college assistant for **Knotopian Institute of Technology (KIT)**. 

Built with a clean decoupled two-tier architecture:
- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, Phone Call Voice Interface, and Browser SpeechSynthesis API.
- **Backend**: FastAPI (Python 3.12), SQLAlchemy ORM, Groq SDK (`openai/gpt-oss-120b`, `whisper-large-v3-turbo`), and College OpenAPI integration.
- **Database**: PostgreSQL support via `psycopg2-binary` with resilient, zero-configuration fallback to SQLite (`sqlite:///./data/quirri_college.db`).
- **Containerization**: Full `docker-compose.yml` orchestrating PostgreSQL, FastAPI backend, and Next.js frontend.

---

## 🌟 Key Capabilities & Modes

### 1. Phone Call Experience ("Talk to it like a phone call")
- **Live Phone Call Interface**: Start Call / End Call buttons, active call duration counter (`00:42`), glowing animated status ring, waveform visualization, and mute/unmute mic controls.
- **Hands-Free Duplex Conversational Loop**: Assistant answers with voice speech output and automatically resumes listening for follow-up questions.
- **Microphone & Speech-to-Text Pipeline**:
  - Web Speech Recognition API with zero-latency streaming.
  - Automatic fallback to MediaRecorder + Groq Whisper (`whisper-large-v3-turbo`) with college domain vocabulary prompt (`Knotopian Institute of Technology`, `Attendance`, `On-duty`, `Leave application`, `Examination`, `Placement`, `Admissions`).
- **Push-to-Talk & Text Fallback**: Works across all desktop and mobile browsers, even behind strict firewalls or when audio permissions are restricted.

### 2. Public Visitor / Prospective Student Portal (No Login Required)
- Live query of official degree programmes (B.Tech CSE, B.Tech ECE, B.Tech MECH), course codes, seats, and tuition/hostel fees via live `/v1/courses` and `/v1/college`.
- 12th standard percentage eligibility verification.
- Official Admissions Brochure 2026 knowledge extraction and FAQ answering.
- Admission application submission via live API `/v1/admissions/applications`.
- Strict RBAC: completely isolates and blocks access to private student and faculty records.

### 3. Student Portal (Authenticated as Arjun K, CSE-2A)
- Real-time attendance percentage query (76.0% overall, 38/50 attended) and subject breakdowns from `/v1/me/attendance`.
- Weekly timetable retrieval (resolves according to college date `/v1/today` -> `Asia/Kolkata`).
- Examination schedule and college calendar conflict checking from `/v1/calendar`.
- Leave request submission workflow:
  - Resolves relative dates ("tomorrow", "next Monday") against the authoritative college date.
  - Verifies no exam clashes per College Rule 6.1.4.
  - Asks for explicit confirmation before submitting to `/v1/me/requests`.
  - Confirms real College API request ID (e.g. Request `#11`).
- On-duty (OD) symposium and competition submission.

### 4. Faculty / Class Advisor Portal (Authenticated as Dr. Lakshmi, CSE-2A)
- Class Advisor class roster and student attendance review.
- Pending student leave and on-duty requests retrieval (`/v1/teacher/requests?status=pending`).
- Request review and explicit approval or rejection with teacher comments via live API (`/v1/teacher/requests/{id}/approve`).

### 5. Persistent History & Audit Trail
- Conversations, messages, and tool executions persisted in PostgreSQL (or SQLite).
- Strict user-level conversation isolation.
- Detailed audit logs for every tool call with execution timestamps and sanitized payloads.

---

## 🏗️ Architecture & Component Layout

```
Temp-hack/
├── backend/                  # FastAPI Python backend
│   ├── app/
│   │   ├── agent/            # Groq orchestrator & tool execution registry
│   │   ├── api/              # REST routes (/api/chat, /api/voice/transcribe, etc.)
│   │   ├── college/          # College API client (/v1/*)
│   │   ├── database/         # SQLAlchemy models & PostgreSQL/SQLite session
│   │   ├── knowledge/        # PDF loader & semantic retrieval
│   │   ├── config.py         # Pydantic settings with Groq & College configurations
│   │   └── main.py           # FastAPI application entrypoint
│   ├── Dockerfile
│   ├── requirements.txt
│   └── tests/                # 12 automated backend integration & unit tests
├── frontend/                 # Next.js 16 TypeScript React frontend
│   ├── src/
│   │   ├── app/              # Next.js App Router (page.tsx, /assistant, /history, /login)
│   │   ├── components/       # VoiceAssistant (Phone Call UI), Transcript, Waveform
│   │   └── lib/              # API client & Auth state
│   ├── Dockerfile
│   ├── package.json
│   └── next.config.ts        # Turbopack config & API proxy rewrites
├── data/
│   ├── college_openapi.json  # Authoritative College OpenAPI schema
│   └── documents/            # College handbooks, brochures, notes, and circulars
├── docker-compose.yml        # Multi-container orchestration (PostgreSQL + Backend + Frontend)
├── .env.example              # Full environment variable reference
└── README.md
```

---

## 🤖 Groq AI Engine Models

| Role | Configured Model | Purpose |
|---|---|---|
| **Primary LLM** | `openai/gpt-oss-120b` | Central agent orchestration and tool calling |
| **Fallback LLM** | `openai/gpt-oss-20b` | High-availability failover on primary model timeout |
| **Primary STT** | `whisper-large-v3-turbo` | Real-time speech-to-text with college domain prompt |

---

## 🔑 Test Credentials

| Role | Login ID | Password | Details |
|---|---|---|---|
| **Student** | `arjun` | `Kit@2026` | Arjun K (Class: CSE-2A, Year 2, UG) |
| **Teacher** | `lakshmi` | `Kit@2026` | Dr. Lakshmi (Class Advisor for CSE-2A) |

---

## 🚀 Getting Started

### Option 1: Run with Docker Compose (Recommended for Full Stack + PostgreSQL)

```bash
# 1. Clone the repository
git clone https://github.com/HARI-Q26/Hack_trail_task.git
cd Hack_trail_task

# 2. Configure environment variables
cp .env.example .env

# 3. Launch PostgreSQL, Backend, and Frontend containers
docker-compose up --build
```
- Frontend UI: `http://localhost:3000`
- Backend API Docs: `http://localhost:8000/docs`
- PostgreSQL: `localhost:5432`

---

### Option 2: Run Locally (Development Mode)

#### 1. Backend (FastAPI)
```bash
cd backend
python -m venv .venv
# On Windows:
.venv\Scripts\activate
# On Linux/macOS:
# source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env

# Start FastAPI server (runs on port 8000)
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

#### 2. Frontend (Next.js)
```bash
cd frontend
npm install
npm run dev
# Open http://localhost:3000 in your browser
```

---

## 🧪 Automated Testing

The backend includes a comprehensive pytest suite covering authorization, RBAC, leave validation, exam clashes, Groq tool execution, and session security:

```bash
cd backend
pytest tests/test_backend.py -v
```
All 12 of 12 tests pass (100% pass rate).

---

## 🛡️ Security & Privacy
- **HTTP-Only Session Cookies**: JWT sessions signed with HMAC-SHA256. Never exposed to browser JavaScript.
- **Role-Based Access Control (RBAC)**: Public visitors cannot access student or teacher records; students cannot approve leaves; teachers cannot modify student attendance.
- **Strict User Isolation**: All personal requests strictly use the verified session identity; user IDs are never passed from untrusted client parameters.
- **Audit Logging**: Every tool execution is recorded with sanitized arguments (passwords and bearer tokens are automatically redacted).
