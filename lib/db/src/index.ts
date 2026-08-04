import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Strip sslmode from the URL — pg-connection-string now treats 'require' as
// 'verify-full' (rejects self-signed chains). We control SSL via Pool config.
const connectionString = process.env.DATABASE_URL.replace(/([?&])sslmode=[^&]*/g, "$1").replace(/[?&]$/, "");

export const pool = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
