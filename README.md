# Kaaryasthan

Kaaryasthan is a multi-tenant workflow management product. The repository is a pnpm monorepo with a Next.js web app, an Express API, and shared TypeScript contracts. `docs/MASTER-PROMPT.md` contains the full product scope; `docs/PHASED-PROMPTS.md` contains the delivery sequence.

## Requirements

- Node.js 22 or newer and pnpm 11
- Docker Desktop for local MongoDB, Redis, Mailpit, and MinIO (later phases)
- A MongoDB Atlas account and two Vercel projects before connecting hosted resources

## Install and check

```powershell
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The API health route is `GET /api/v1/health`. The web landing page is `/`.

## Local development

The web and API are deployed as separate Vercel projects. For local development, configure the environment values described in `docs/ARCHITECTURE.md` before running `pnpm dev`. Never commit `.env` files or credentials. Local infrastructure is defined in `docker-compose.yml`; Docker is required to start it. Copy `.env.example` to `.env`, set a local MinIO password, then run `docker compose up -d`. Initialize the MongoDB replica set before using transactions in later phases.

## Deployment layout

Import this single GitHub repository into Vercel twice. Set Root Directory to `apps/web` for the web project and `apps/api` for the API project. Enable access to source files outside the root directory so both can import `packages/shared`. Put the Atlas connection string only in the API project's environment variables.

The repository is at the foundation stage. Auth, tenant data, and task management are future phases. The health route does not connect to MongoDB; `GET /api/v1/ready` checks the Atlas connection using the API project's `MONGODB_URI`.
