# NodeWave Delivery API

Backend API for a delivery management system with role and attribute based
access control, dependency aware task states, optimistic locking, immutable
audit logs, soft deletes, and strict client tenant isolation.

- **Live API:** `https://nodewave-delivery-api-production-f2a6.up.railway.app/`
- **Health check:** `https://nodewave-delivery-api-production-f2a6.up.railway.app//health`
- **Frontend repository:**
  [DanielRidho/nodewave-delivery-web](https://github.com/DanielRidho/nodewave-delivery-web)

Replace `https://nodewave-delivery-api-production-f2a6.up.railway.app/` with the generated Railway domain after
deployment. Do not add `/api` to the health check URL; API resources use the
`/api` prefix.

## Technology

- TypeScript with strict mode
- Bun and Hono
- PostgreSQL with Prisma ORM
- JWT authentication backed by revocable database sessions
- Zod request validation
- `@nodewave/prisma-ezfilter` for list inference
- Vitest, Biome, Husky, and Commitlint

## Run locally

Install [Bun](https://bun.sh/docs/installation),
[Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/),
and Git. No global Prisma or TypeScript installation is required.

Clone the repository and start PostgreSQL:

```powershell
git clone https://github.com/DanielRidho/nodewave-delivery-api.git
cd nodewave-delivery-api

docker run --name nodewave-postgres `
  -e POSTGRES_USER=nodewave `
  -e POSTGRES_PASSWORD=nodewave `
  -e POSTGRES_DB=nodewave_delivery `
  -p 5432:5432 `
  -d postgres:16-alpine
```

Create the local environment file:

```powershell
Copy-Item .env.example .env
```

The example values already target the Docker container above. Change
`JWT_SECRET` before using the application outside local development.

Install, migrate, seed, and start the API:

```powershell
bun install --frozen-lockfile
bun run db:generate
bun run db:deploy
bun run db:seed
bun run dev
```

The API will be available at `http://localhost:3001/api`. Verify the database
connection at `http://localhost:3001/health`.

If the PostgreSQL container already exists but is stopped, run:

```powershell
docker start nodewave-postgres
```

## Seeded accounts

All seeded accounts use password `Password123!`. These credentials are kept in
the documentation and are intentionally absent from the login screen.

| Actor | Email | Scope |
|---|---|---|
| Product Manager | `pm@nodewave.test` | Full project/task core management; cannot complete executor work |
| UI/UX | `uiux@nodewave.test` | Assigned projects and own UI/UX task execution |
| Frontend | `frontend@nodewave.test` | Assigned projects; dependency guarded Frontend execution |
| Backend | `backend@nodewave.test` | Assigned projects and own Backend task execution |
| Client Nusa | `client@nusa.test` | Nusa metrics and client visible Nusa tasks only |
| Client Aruna | `client@aruna.test` | Aruna metrics and client visible Aruna tasks only |

## Access and workflow rules

- Product Managers can create and update projects and task core fields, define
  dependencies, and choose client visibility. They cannot move an
  `IN_PROGRESS` task to `DONE`.
- Internal users can read only projects where they have an active membership.
  Only the assigned engineer from the matching department can attach work,
  start the task, and complete it.
- A `TODO` task becomes effectively `BLOCKED` while any prerequisite is not
  `DONE`. The stored status remains `TODO`, so it automatically becomes ready
  after every prerequisite is completed.
- Client users are scoped by `clientProjectId`. Cross tenant project requests
  return `404`, and task queries always add `clientVisible: true`.
- Client responses use an explicit field allow-list. Assignees, engineer names,
  avatars, departments, internal comments, audit history, attachments, and
  dependency details are omitted by the API.

## Concurrency and audit integrity

Every task mutation includes `expectedVersion`. Updates use an atomic condition
equivalent to `WHERE id = ? AND version = ?`, then increment the version. A
stale request receives `409 VERSION_CONFLICT` instead of overwriting a newer
change.

Task changes and their audit entries are written in the same database
transaction. Audit entries store the actor, timestamp, changed column, old
value, and new value. PostgreSQL triggers reject both `UPDATE` and `DELETE` on
the `AuditLog` table. Business entities use `deletedAt` for soft deletion.

Dependency writes reject self dependencies, cross project dependencies,
duplicates, and directed cycles. Cycle detection and persistence run in a
serializable transaction.

## Main endpoints

All endpoints except registration and login require
`Authorization: Bearer <token>`.

| Method | Path | Access |
|---|---|---|
| POST | `/api/auth/register` | Public client registration with a project access code |
| POST | `/api/auth/login` | Public |
| POST | `/api/auth/logout` | Authenticated; revokes the database session |
| GET | `/api/auth/me` | Authenticated |
| GET/POST | `/api/projects` | Scoped read; create only for PM |
| PATCH/DELETE | `/api/projects/:projectId` | PM; delete is soft delete |
| GET | `/api/projects/:projectId/tasks` | PM, active member, or bound client tenant |
| GET | `/api/projects/:projectId/members` | PM/internal only |
| POST | `/api/tasks` | PM |
| GET/PATCH/DELETE | `/api/tasks/:taskId` | Scoped read; core update/delete only for PM |
| PATCH | `/api/tasks/:taskId/status` | PM/executor subject to state policy |
| POST | `/api/tasks/:taskId/dependencies` | PM |
| POST | `/api/tasks/:taskId/attachments` | PM or matching executor |
| POST | `/api/tasks/:taskId/comments` | PM/internal only |
| GET | `/api/tasks/:taskId/audit-logs` | PM/internal only |
| GET | `/api/reports/:projectId/daily-standup` | PM/internal bonus endpoint |

Successful responses use `{ "success": true, "data": ..., "meta": ... }`.
Errors use `{ "success": false, "error": { "code": ..., "message": ... } }`.

## Filtering, searching, and pagination

List endpoints accept the same optional query parameters:

- `filters`: exact matching; keys are combined with AND and array values with
  OR.
- `searchFilters`: case insensitive contains matching; multiple keys use OR.
- `rangedFilters`: inclusive `start` and `end` ranges.
- `page`, `rows`, `orderKey`, and `orderRule`.

Object and array values must be serialized with `JSON.stringify` before being
added to the query string. Invalid JSON, unsupported fields, incompatible value
types, and invalid pagination return `400`.

```text
GET /api/projects/{id}/tasks?filters={"status":["TODO","IN_PROGRESS"]}&searchFilters={"title":"checkout","description":"checkout"}&page=1&rows=20&orderKey=updatedAt&orderRule=desc
```

Tenant conditions are added independently after parsing user filters, so query
parameters cannot broaden a user's data scope.

## Quality checks

```powershell
bun run typecheck
bun run lint
bun run test
```

The backend suite currently contains 17 tests covering state policy, response
masking, and the filtering/search/range/pagination contract.

## Railway deployment

The root `Dockerfile` is ready for Railway. Configure these service variables:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=<random-secret-at-least-32-characters>
FRONTEND_URL=https://YOUR-FRONTEND-DOMAIN
```

Use `bun run db:deploy && bun run db:seed` for the first pre-deploy command.
After the first successful seed, change it to `bun run db:deploy`. Configure
`/health` as the Railway health check path. Never commit `.env`, `DATABASE_URL`,
or `JWT_SECRET`.
