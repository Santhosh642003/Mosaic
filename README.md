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

## Deploy

Docker Compose is production-ready. For Railway: connect repo → add Postgres + Redis plugins → set env vars → deploy.
