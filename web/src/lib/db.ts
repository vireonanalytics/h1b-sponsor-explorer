import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
}

export const pool =
  global._pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL ?? "postgresql:///h1b_explorer",
    max: 10,
  });

if (process.env.NODE_ENV !== "production") {
  global._pgPool = pool;
}
