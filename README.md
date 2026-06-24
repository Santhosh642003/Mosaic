# Mosaic

Collaborative AI coding platform for hackathon teams. Teams join a shared room, AI decomposes the project brief into parallelizable tasks, each teammate codes simultaneously with an AI pair programmer, then AI semantically merges all codebases.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind + Monaco Editor |
| Realtime | Socket.io (Redis pub/sub for multi-worker) |
| Backend | Python 3.11 + FastAPI + python-socketio |
| Database | PostgreSQL 16 (SQLAlchemy 2 async + Alembic) |
| Cache | Redis 7 |
| LLM | Groq API — DeepSeek-R1 for decomp/merge, Qwen for coding |
| Auth | JWT (python-jose) + bcrypt + GitHub OAuth |

## Quick start

```bash
cp .env.example .env
# Fill in GROQ_API_KEY and JWT_SECRET
docker compose up
# Frontend: http://localhost  Backend: http://localhost:8000/docs
```

## Development

### Backend
```bash
cd backend
pip install -r requirements.txt
docker compose up postgres redis -d
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend && npm install && npm run dev
```

## Environment variables

See `.env.example`. Required: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `GROQ_API_KEY`.
Optional: `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` for OAuth.

## User flow

1. **Create room** — Lead sets project brief + language stack, gets a 6-char code
2. **Join** — Teammates join via code (guest or authenticated)
3. **Lobby** — Lead starts decomposition once ready
4. **Decompose** — DeepSeek-R1 breaks brief into parallel tasks with interface contracts
5. **Code** — Each teammate codes in Monaco with Qwen as AI pair programmer
6. **Merge** — Lead triggers semantic merge; result downloads as ZIP

## API routes

```
POST /api/auth/register|login         GET /api/auth/me
GET  /api/auth/github                 GET /api/auth/github/callback

POST /api/rooms                       GET /api/rooms
GET  /api/rooms/:code                 GET /api/rooms/:code/state
POST /api/rooms/:code/join            GET /api/rooms/:code/tasks
POST /api/rooms/:code/tasks/:id/assign|submit
POST /api/rooms/:code/merge           GET /api/rooms/:code/merge/result|download

GET  /api/users/me    PATCH /api/users/me    GET /api/users/me/codebases
```

## Robustness guards

| Guard | Status | Description |
|---|---|---|
| Structured LLM output | ✅ Implemented | `instructor` wraps Groq client; Pydantic models (`TaskDecomposition`, `MergeResult`) enforced with 3-retry validation. DeepSeek-R1 `<think>` blocks stripped before parse. |
| Contract drift — approval flow | ✅ Implemented | Contracts are locked and displayed. Builders request changes via `request_contract_change` socket event → Lead approves/rejects → `contract_updated` broadcast refreshes all panels. Contract versions logged in DB. |
| Post-merge AST validation | ✅ Implemented | Python files validated with `ast.parse()`, JS files with `node --check`. Failures trigger one self-correction LLM pass. Remaining errors flagged in conflict report; download still allowed. |

## Roadmap (V2)

- **Automatic contract renegotiation** — Detect interface contract changes inside a builder's code automatically, update the shared contract, and nudge affected AI coding sessions without requiring manual approval.
- **Full compile + type validation** — Run `mypy` (Python) and `tsc` (TypeScript) on the merged project, execute the project in a sandboxed container, and surface type errors and runtime failures before the ZIP is generated.

## Deploy

Docker Compose is production-ready. For Railway: connect repo → add Postgres + Redis plugins → set env vars → deploy.
