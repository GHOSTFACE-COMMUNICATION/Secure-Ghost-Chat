import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // pg_stat_statements is a Postgres extension Railway enables for its own
  // query-monitoring dashboard — its views aren't ours to manage, and a
  // plain `push` will try to drop them (and fail, since the extension
  // depends on them) without this filter.
  tablesFilter: ["!pg_stat_statements*"],
});
