# VedaFlux — Complete Run Guide

## 1. Install

Required:

- Docker Desktop
- Node.js 22 LTS
- npm
- Git

The repository also includes `requirements.txt` for the Python AI sidecar.

## 2. Configure credentials

Copy:

`backend/.env.example` → `backend/.env`

Fill these values:

```env
GROQ_API_KEY=your_groq_key
GROQ_MODEL=openai/gpt-oss-120b

GITHUB_TOKEN=your_github_token
GITHUB_OWNER=your_owner
GITHUB_REPO=your_repo

JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=your-jira-email
JIRA_API_TOKEN=your-jira-api-token

SLACK_BOT_TOKEN=xoxb-your-token
```

Generate strong random values for:

```env
JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...
```

Do not commit `backend/.env`.

## 3. Start infrastructure

```bash
cd backend
docker compose up -d postgres redis ai-service
```

Wait until the AI service reports healthy at:

`http://localhost:8001/health`

## 4. Initialize the database

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
```

The database image includes pgvector.

## 5. Start backend

```bash
npm run start:dev
```

Backend: `http://localhost:7000`
Swagger: `http://localhost:7000/docs`

## 6. Start frontend

```bash
cd ../frontend
npm ci
npm run dev
```

Open:

`http://localhost:5173`

## 7. Create connectors from the existing Connectors page

### GitHub config

```json
{
  "owner": "YOUR_OWNER",
  "repo": "YOUR_REPO",
  "branch": "main",
  "includeCommits": true,
  "includePullRequests": true,
  "maxFiles": 200,
  "maxCommits": 50,
  "maxPullRequests": 25
}
```

### Jira config

```json
{
  "projectKey": "YOUR_PROJECT_KEY",
  "maxIssues": 100
}
```

### Slack config

```json
{
  "channelIds": ["YOUR_CHANNEL_ID"],
  "oldestDays": 30,
  "maxMessagesPerChannel": 15
}
```

Click **Create**, then **Test**, then **Sync**.

## 8. What gets indexed

GitHub indexes repository source files plus commit and pull-request evidence. Pull requests include changed-file patches when GitHub returns them.

Jira indexes issue details and comments returned by the Jira Cloud search API.

Slack indexes channel messages and available thread replies.

The existing RAG pipeline then extracts/chunks content, creates embeddings, stores them in pgvector, performs hybrid retrieval and sends retrieved evidence to the AI service for the final answer.

## 9. Security notes

- Connector credentials are read from environment variables, not Connector JSON.
- Keep `backend/.env` private.
- The Groq model receives the retrieved context used for the answer. If your organization requires that source code never leave your infrastructure, replace the Groq call in `ai-service/main.py` with a self-hosted LLM endpoint.
