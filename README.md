# Gas Queue API — NestJS + Prisma (simple version, no authentication)

Implements the rules of *gas-Ayham.md* (final plan v3.0): booking window, quota ledger, capacity check,
strict queue order (carried → new → shelved), gate actions, close-day rollover and manifest text for WhatsApp.

## Run

```bash
# 1) PostgreSQL (or use your own)
docker run -d --name gasdb -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=gasqueue -p 5432:5432 postgres:16

# 2) project
cp .env.example .env
npm install
npx prisma migrate dev --name init          # creates the tables
psql "postgresql://postgres:postgres@localhost:5432/gasqueue" -f prisma/triggers.sql   # optional: append-only ledger/audit + CHECKs
npm run start:dev                            # http://localhost:3000/api/v1
```

Then import `postman/Gas-Queue-API.postman_collection.json` into Postman and run the collection top to bottom.

## Structure (controller + service + dto per module)

```
prisma/schema.prisma      data model
src/agents  transporters  vehicles  bays  links  quotas     master data
src/days                  queue day, booking window, pause line, close-day rollover
src/bookings              create / edit / cancel (all validation lives here)
src/queue                 live board + "tickets ahead"
src/gate                  call-next, start, loaded, skip, late, absent, restore
src/manifests             frozen manifest versions + WhatsApp text
src/reports  audit  settings  health
```

## No login — how "who is booking" works

There is no authentication, so the client states who it is in the body:

| `bookedByRole` | `actorId` | Server checks |
|---|---|---|
| `STAFF` (default) | free text (clerk name) | nothing extra |
| `AGENT` | the agent's id | every line must be that agent's own quota |
| `TRANSPORTER` | the transporter's id | must be his own truck **and** the agent↔transporter link must be `APPROVED` |

## Business rules that are enforced

Window open (server clock) · vehicle belongs to transporter · vehicle allowed for the lane · sum of lines ≤ capacity ·
each agent's quantity ≤ available quota · one active ticket per vehicle per day (setting) · positions and booking numbers
assigned by the server under a per-day advisory lock · every state change is guarded by status + version (double click safe).

Error body is always `{ "code": "QUOTA_EXCEEDED", "message": "...", "details": {...} }`.
Codes: `WINDOW_CLOSED, QUOTA_EXCEEDED, NO_QUOTA, CAPACITY_EXCEEDED, TYPE_MISMATCH, VEHICLE_HAS_ACTIVE_TICKET, LINK_NOT_APPROVED,
NOT_OWNER, TICKET_NOT_EDITABLE, DAY_HAS_ACTIVE_TICKETS, VERSION_CONFLICT, INVALID_TRANSITION, LINE_PAUSED, BAY_BUSY, REASON_REQUIRED, ...`

## Settings (`GET/PATCH /settings`)

`booking_window_minutes=60` · `one_active_ticket_per_vehicle=true` · `late_unserved_policy=CARRY_TO_FRONT|CANCEL` ·
`absent_all_day_policy=CANCEL|CARRY_TO_FRONT` · `max_carry_days=2` · `auto_call_next=true` · `manifest_chunk_size=40`

## Left out on purpose (to keep it simple) — can be added later

JWT/roles/activation codes · Socket.IO live feed (poll `GET /queue/today` every 5–10 s instead) · scheduler that opens/closes
windows automatically (use `open-booking` / `close-booking`) · idempotency keys · hash-chained audit (audit rows are kept, without the chain) ·
undo · PDF/Excel export · Excel import · Swagger · backups.
