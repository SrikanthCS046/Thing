# VedaFlux

VedaFlux is an AI-powered developer onboarding assistant built on the uploaded Thing frontend/backend foundation.

## Integrated sources

- GitHub: source files, commits, pull requests and changed-file patches.
- Jira Cloud: JQL-indexed issues and comments.
- Slack: channel history and thread replies.

## AI/RAG

The existing RAG pipeline is connected to a FastAPI AI sidecar. The sidecar provides document extraction, local sentence-transformer embeddings, reranking, and Groq-backed chat/summarization.

## Quick start

See [`VEDAFUX_RUN_GUIDE.md`](./VEDAFUX_RUN_GUIDE.md) for the exact setup, environment variables, connector JSON examples and run commands.

The Python dependency entrypoint requested for the project is [`requirements.txt`](./requirements.txt). The NestJS and React dependencies remain managed by their existing `package.json` and lockfiles.
