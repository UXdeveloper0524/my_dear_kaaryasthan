# TaskFlow: How to Build It with Codex

## What is in this kit
| File | Where it goes |
|---|---|
| `AGENTS.md` (your frontend developer agent) | `~/.codex/AGENTS.md` (global, already set up) |
| `PROJECT-AGENTS.md` | repo root, rename to `AGENTS.md` |
| `AGENTS-api.md` | `apps/api/AGENTS.md` |
| `AGENTS-web.md` | `apps/web/AGENTS.md` |
| `MASTER-PROMPT.md` | `docs/MASTER-PROMPT.md` |
| `DEPLOYMENT-VERCEL.md` | `docs/DEPLOYMENT-VERCEL.md` |
| `PHASED-PROMPTS.md` | keep it handy; you paste prompts from it |

Codex reads the global file first, then the files closer to the folder you are working in, so the root, API, and web files stack on top of your global agent.

## One-time setup
1. Install Node 20+, pnpm, Docker, and Git.
2. Create the repo: `mkdir taskflow && cd taskflow && git init`, then add `docs/` and copy the files into the locations above.
3. Commit the docs: `git add . && git commit -m "docs: add project instructions and specs"`.
4. Create accounts you will need (you can add them as phases require): MongoDB Atlas, Vercel, a Redis provider, a queue provider, a realtime provider, an email provider, Meta developer account for WhatsApp Cloud API, Stripe and/or Razorpay.
5. Start Codex in the repo root.

## The loop for every phase
1. Paste **Kickoff** from PHASED-PROMPTS.md (fill in the phase number and name).
2. Read the plan. Cut anything extra, correct any wrong assumptions, then approve.
3. Paste **Implement**.
4. Verify yourself: run the app, click through the feature, run `git diff`.
5. Paste **Close**, then commit when acceptance criteria are met.

Work in the phase order. Phases 0 to 7 and 12 to 13 give you a usable core product (auth, tenants, projects, tasks, live boards). Phases 8 to 11 and 14 add the signature features that make it unique. Phases 15 to 18 complete the full feature set and launch.

## Reality check on scope
The full feature set is a large product. Done solo with Codex, expect many months, not weeks. To get value earlier:
- Treat the end of Phase 13 as a first internal release and use it with your own team.
- Ship Blockers (Phase 8 and its UI) next, since they are quick to demo and unique.
- Add the Request desk, forecasting, and WhatsApp one at a time, each to a few real users, before building the long tail.

## Tips for good results
- Keep each Codex task to one module or one screen. Large vague tasks produce shallow code.
- When it makes the same mistake twice, add one line to the nearest `AGENTS.md`.
- Keep `docs/` current; it is the memory of the project between sessions.
- Run the **Review** prompt (see PHASED-PROMPTS.md) before every merge to catch tenant leaks, missing permission checks, and serverless violations.
- Never let it commit, push, or deploy on its own. Review `git diff` first.
- Test deployments early: deploy the Phase 2 health check to a Vercel preview so serverless problems show up before there is a lot of code.

## Before you sell it
- Confirm Vercel plan terms for commercial use and the cron limits you need.
- Check WhatsApp Business Cloud API policies, template approval, and pricing for your target countries.
- Prepare a privacy policy, terms of service, and a data processing agreement; get legal advice for your jurisdictions.
- Decide pricing and plan limits (seats, projects, WhatsApp messages) from your measured costs.
