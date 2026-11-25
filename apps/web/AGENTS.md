# AGENTS.md: apps/web (Next.js App Router on Vercel)

Place this file at `apps/web/AGENTS.md`. It adds to the root project rules and the global frontend agent.

## Structure
```
src/
  app/
    (auth)/        login, register, forgot/reset, verify, 2fa
    (app)/         authenticated app shell: dashboard, projects, tasks, requests, reports
    (admin)/       admin panel
    (portal)/      requester portal and public request forms
  features/<name>/ components, hooks, api, schemas, types (tasks, projects, blockers, requests, forecast, whatsapp, ...)
  components/ui/   shadcn/ui primitives and design system
  lib/             api client, auth helpers, realtime provider, utils, i18n
  middleware.ts    route protection
```

## Rules
- Server Components by default. `"use client"` only for interactivity (boards, forms, drag-and-drop, realtime, charts) and keep client boundaries small.
- Initial data loads on the server where it helps; TanStack Query handles interactive data, mutations, and cache invalidation. Define query keys in one place per feature.
- Typed API client in `lib/api` using Zod schemas and types from `packages/shared`. No `fetch` calls scattered in components.
- Auth: httpOnly cookies set by the API. `middleware.ts` redirects unauthenticated users and applies role checks, and server components re-check permissions. Never store tokens in localStorage.
- Permission-aware UI via a `can(permission)` helper backed by `packages/shared`. The API remains the authority.
- Realtime through a `RealtimeProvider` that talks to the `RealtimeGateway` client adapter (managed provider by default). On events, update the TanStack Query cache; show presence and live board changes.
- Optimistic updates for drag-and-drop, status changes, and quick edits, with rollback and a visible error on failure.
- Forms: React Hook Form + Zod, inline errors from API validation responses, disabled submit while pending.
- Drag-and-drop with dnd-kit, including keyboard sensors and screen reader announcements.
- Heavy components (Gantt, charts, rich-text editor) loaded with dynamic imports.
- i18n with next-intl from day one; no hard-coded user-facing strings in components. Dark/light mode with next-themes.
- Accessibility: WCAG 2.1 AA, visible focus, labels, ARIA live regions for async updates, reduced-motion support.
- Performance: `next/image`, `next/font`, route-level `loading.tsx` and `error.tsx`, no unnecessary client JS, watch bundle size.
- Environment: only `NEXT_PUBLIC_*` values reach the browser. Server secrets stay server-side.

## Testing
- Vitest + React Testing Library for components and hooks (permission states, form validation, optimistic rollback).
- Playwright for critical flows: login, create project, create and move task, raise and resolve a blocker, submit and approve a request.
- Run `pnpm --filter web lint`, `typecheck`, `test`, and `build` before reporting done. Check at mobile, tablet, and desktop widths and with the keyboard only.
