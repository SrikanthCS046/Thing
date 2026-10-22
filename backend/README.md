# VedaFlux Backend

This backend is the NestJS API/worker for VedaFlux. The frontend remains the existing React/Vite UI.

## What is live in this version

- GitHub connector: repository files, recent commits, pull requests, changed-file patches, and source URLs.
- Jira connector: Jira Cloud JQL issue retrieval with descriptions, comments, statuses, assignees, reporters, labels and source URLs.
- Slack connector: channel history and thread replies for channels the configured Slack token can access.
- AI service: FastAPI sidecar for PDF/DOCX/text extraction, local sentence-transformer embeddings, lexical reranking and Groq-powered answers/summaries.
- Existing Prisma/PostgreSQL/pgvector, Redis/BullMQ, RAG, chat, summaries and frontend flow are retained.

## Connector configuration

Credentials are read from `backend/.env` and are not persisted in the Connector JSON config.

### GitHub

```json
{
  "owner": "your-org",
  "repo": "your-repository",
  "branch": "main",
  "includeCommits": true,
  "includePullRequests": true,
  "maxFiles": 200,
  "maxCommits": 50,
  "maxPullRequests": 25
}
```

You can also set `GITHUB_OWNER` and `GITHUB_REPO` in `.env` and leave the JSON as `{}`.

### Jira

```json
{
  "baseUrl": "https://your-domain.atlassian.net",
  "projectKey": "ABC",
  "maxIssues": 100
}
```

The credentials come from `JIRA_EMAIL` and `JIRA_API_TOKEN`. `JIRA_BASE_URL` can be used instead of `baseUrl`.

### Slack

```json
{
  "channelIds": ["C0123456789"],
  "oldestDays": 30,
  "maxMessagesPerChannel": 15
}
```

The token comes from `SLACK_BOT_TOKEN`. For private channels, the app must be a member and have the required history permissions.

## Local run

1. Copy `backend/.env.example` to `backend/.env` and fill in the AI/connector credentials.
2. From `backend/`, start PostgreSQL, Redis and the AI service:

```bash
docker compose up -d postgres redis ai-service
```

3. Install/build the backend:

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
npm run start:dev
```

4. Start the unchanged frontend in another terminal:

```bash
cd ../frontend
npm ci
npm run dev
```

Frontend: `http://localhost:5173`
Backend: `http://localhost:7000`
Swagger: `http://localhost:7000/docs`
AI health: `http://localhost:8001/health`

## Full Docker run

Create `backend/.env` first, then:

```bash
cd backend
docker compose up --build
```

The compose file uses `pgvector/pgvector:pg17` so the database can create the `vector` extension required by the existing Prisma migrations.
