import { pool } from "./db";

export async function createInvite(code: string, payload: any) {
  await pool.query(
    `INSERT INTO invites (code, payload) VALUES ($1, $2)`,
    [code, payload]
  );
}

export async function getInvite(code: string) {
  const result = await pool.query(
    `SELECT payload FROM invites WHERE code = $1`,
    [code]
  );
  return result.rows[0]?.payload || null;
}

export async function consumeInvite(code: string) {
  await pool.query(`DELETE FROM invites WHERE code = $1`, [code]);
}

