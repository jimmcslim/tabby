import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite"
import type * as schema from "./schema"
import fs from "fs"
import path from "path"

type DB = BunSQLiteDatabase<typeof schema>
/**
 * Transaction handle passed to `db.transaction()` callbacks — for call sites
 * that take one as a parameter. Callees receiving a `Tx` must stay
 * synchronous (`.all()`/`.get()`/`.run()`, no `await`) until the driver
 * swaps off bun:sqlite: its sync transaction() discards an async callback's
 * returned Promise and commits before any awaited work resolves.
 */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0]

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "tabby.db")

let _db: DB | null = null

/**
 * Where drizzle-kit writes migrations (see drizzle.config.ts). Read from disk
 * at startup, so the folder has to ship with the app — the Dockerfile copies it
 * into the standalone image.
 */
const MIGRATIONS_DIR = path.join(process.cwd(), "lib", "db", "migrations")

async function initDb(): Promise<DB> {
  const { Database } = await import("bun:sqlite")
  const { drizzle } = await import("drizzle-orm/bun-sqlite")
  const { migrate } = await import("drizzle-orm/bun-sqlite/migrator")
  const s = await import("./schema")

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
  const sqlite = new Database(DB_PATH, { create: true })
  sqlite.exec("PRAGMA journal_mode = WAL")
  sqlite.exec("PRAGMA foreign_keys = ON")
  // Let a writer wait for a lock instead of throwing SQLITE_BUSY immediately —
  // concurrent syncs (bulk restore's follow-up sync, background AI/OG writes)
  // would otherwise fail outright rather than briefly queue.
  sqlite.exec("PRAGMA busy_timeout = 5000")

  const db = drizzle(sqlite, { schema: s })

  // Schema lives in lib/db/migrations, applied on every boot.
  //
  // Databases created by the pre-migration bootstrap (CREATE TABLE IF NOT
  // EXISTS + try/catch ALTERs at startup) have the full schema but no
  // __drizzle_migrations table, so drizzle would try to apply 0000 to them.
  // Rather than baseline-marking those rows behind drizzle's back, the 0000
  // migration is written as IF NOT EXISTS throughout: applying it to such a
  // database is a no-op that just records the migration, and applying it to an
  // empty file creates the schema. Migrations after 0000 are plain generated
  // SQL — the special case is the baseline only.
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })

  return db
}

let _initPromise: Promise<DB> | null = null

export async function getDb(): Promise<DB> {
  if (_db) return _db
  if (!_initPromise) _initPromise = initDb()
  _db = await _initPromise
  return _db
}
