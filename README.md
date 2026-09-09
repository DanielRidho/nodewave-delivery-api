# NodeWave Delivery API

Base URL lokal: `http://localhost:3001/api`

Semua endpoint selain register/login membutuhkan header `Authorization: Bearer <token>`.

## Endpoint

| Method | Path | Access |
|---|---|---|
| POST | `/auth/register` | Public; registrasi Client Guest dengan project access code |
| POST | `/auth/login` | Public |
| POST | `/auth/logout` | Authenticated; session direvoke di database |
| GET | `/auth/me` | Authenticated |
| GET/POST | `/projects` | GET sesuai scope; POST hanya PM |
| PATCH/DELETE | `/projects/:projectId` | PM; DELETE mengisi `deletedAt` |
| GET | `/projects/:projectId/tasks` | PM, project member, atau client tenant terikat |
| GET | `/projects/:projectId/members` | Internal/PM; ditolak untuk Client |
| POST | `/tasks` | PM |
| GET/PATCH/DELETE | `/tasks/:taskId` | Read sesuai scope; update/delete core hanya PM |
| PATCH | `/tasks/:taskId/status` | PM/executor sesuai state policy |
| POST | `/tasks/:taskId/dependencies` | PM; same-project, non-self, dan cycle-safe |
| POST | `/tasks/:taskId/attachments` | PM atau executor; menerima `fileName` + `fileUrl` |
| POST | `/tasks/:taskId/comments` | Internal/PM; ditolak untuk Client |
| GET | `/tasks/:taskId/audit-logs` | Internal/PM; ditolak untuk Client |
| GET | `/reports/:projectId/daily-standup` | Internal/PM; ringkasan bonus per department |

Format response sukses:

```json
{ "success": true, "data": {}, "meta": {} }
```

Format error:

```json
{
  "success": false,
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "Task sudah diubah oleh pengguna lain. Muat ulang data sebelum mencoba lagi."
  }
}
```

Status penting: `400` query/dependency invalid, `401` sesi invalid, `403` policy menolak, `404` data di luar scope, `409` conflict/cycle, dan `422` DTO validation.

## Query list standar

Endpoint `GET /projects`, `GET /projects/:projectId/tasks`, `GET /projects/:projectId/members`, dan `GET /tasks/:taskId/audit-logs` menerima kontrak yang sama:

- `filters` untuk exact match; beberapa key menggunakan AND dan array value menggunakan OR.
- `searchFilters` untuk pencarian `contains`; beberapa key string menggunakan OR.
- `rangedFilters` untuk rentang `gte` dan `lte` yang inklusif.
- `page`, `rows`, `orderKey`, dan `orderRule` untuk pagination serta sorting.

`filters`, `searchFilters`, dan `rangedFilters` harus dikirim sebagai JSON hasil `JSON.stringify`. JSON rusak, field yang tidak diizinkan, tipe value yang salah, page di bawah 1, atau rows di atas 100 menghasilkan `400`, bukan query tanpa filter.

Contoh:

```text
GET /projects/{id}/tasks?filters={"status":["TODO","IN_PROGRESS"]}&searchFilters={"title":"checkout","description":"checkout"}&rangedFilters=[{"key":"dueDate","start":"2026-09-01T00:00:00.000Z","end":"2026-09-30T23:59:59.999Z"}]&page=1&rows=20&orderKey=updatedAt&orderRule=desc
```

Tenant scope dan `clientVisible` selalu digabungkan oleh backend sesudah query pengguna diproses. Client Guest juga tidak diizinkan memfilter atau mengurutkan berdasarkan department sehingga filter tidak dapat dipakai sebagai side channel untuk menyimpulkan data internal.

## Deployment

Repository backend siap dibangun Railway melalui `Dockerfile`. Atur `DATABASE_URL`, `JWT_SECRET`, dan `FRONTEND_URL`; gunakan `bun run db:deploy` sebagai pre-deploy command dan jalankan `bun run db:seed` sekali pada deployment pertama. Healthcheck `/health` sekaligus memeriksa koneksi PostgreSQL.

Panduan langkah demi langkah tersedia pada `DEPLOYMENT.md` di folder induk sebelum kedua folder dipisahkan menjadi repository.
