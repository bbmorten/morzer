# Money + Postgres NUMERIC + Dinero.js ("deniro.js")

## Goals

- Use Postgres `NUMERIC` for exact storage.
- Avoid JS floating point for money arithmetic.
- Make conversions explicit and testable.

## Recommended schema pattern (minor units)

Use `NUMERIC(20,0)` to store minor units (cents, pence, etc.) with integer semantics.

Example table columns:
- `amount_minor NUMERIC(20,0) NOT NULL`
- `currency_code CHAR(3) NOT NULL`

Why:
- Exact representation.
- No implicit rounding.
- Maps cleanly to Dinero.js amount in minor units.

### Converting to Dinero.js

At the DB boundary:
- Read `amount_minor` as a **string**.
- Convert to `bigint` in Node.
- Construct money using Dinero.js with `amount` in minor units.

Notes:
- Prefer Dinero.js v2 patterns (bigint-based) when available.
- Do not convert via `Number(amount_minor)`.

## Alternative pattern (fixed scale major units)

If you must store major units like `12.34`, use `NUMERIC(20,2)`.

Rules:
- Treat values as strings in Node.
- Convert to minor units with decimal-safe math.

Example approach:
- Parse the string using a decimal library (e.g., `decimal.js`) or your ORM’s Decimal type.
- Multiply by 10^scale and round using a defined mode.

## ORM mapping guidance

### Prisma

- Prisma maps Postgres `NUMERIC` to `Decimal` (backed by `decimal.js`).
- Keep `Decimal` at the boundary; serialize as string over JSON.
- For `NUMERIC(20,0)` minor units:
	- Convert `Decimal` → string → `BigInt(...)`.

### Drizzle/Kysely/Knex

- Configure the Postgres driver to return numerics as strings.
- Keep them as strings until you explicitly convert.

## API/JSON contracts

- Never expose money as a JSON number.
- Use:
	- `{ amountMinor: "1234", currency: "USD" }`
	- or `{ amount: "12.34", currency: "USD", scale: 2 }`

## Testing guidance

Add tests that cover:
- Currency scale boundaries (e.g., JPY scale 0 vs USD scale 2)
- Large values (over JS safe integer range)
- Rounding rules (half-up vs bankers rounding) where relevant

## Migration tips

- If converting from `NUMERIC(20,2)` major units to `NUMERIC(20,0)` minor units:
	- Create new column `amount_minor`.
	- Backfill with `ROUND(amount * 100)` using an explicit rounding rule.
	- Switch app reads/writes.
	- Drop old column after verification.
