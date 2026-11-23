import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serviceRoot = path.resolve(__dirname, '..');

function loadEnvFile(filePath, prefix = '') {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let val = trimmed.slice(eqIndex + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    result[prefix + key] = val;
  }
  return result;
}

const targetEnv = {
  ...loadEnvFile(path.join(serviceRoot, '.env')),
  ...process.env,
};
const sourceEnv = {
  ...loadEnvFile(path.resolve(serviceRoot, '../gym_project/.env')),
  ...process.env,
};

function sanitizeIdent(value, fallback) {
  const clean = (value || fallback || '').trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(clean)) {
    throw new Error(`Invalid SQL identifier: ${clean}`);
  }
  return clean;
}

function buildSourceConfig() {
  if (targetEnv.SOURCE_DATABASE_URL) {
    return {
      connectionString: targetEnv.SOURCE_DATABASE_URL.trim(),
      ssl:
        targetEnv.SOURCE_DB_SSL === 'true'
          ? { rejectUnauthorized: false }
          : false,
    };
  }

  return {
    host: targetEnv.SOURCE_DB_HOST || sourceEnv.DB_HOST || 'localhost',
    port: Number(targetEnv.SOURCE_DB_PORT || sourceEnv.DB_PORT || 5432),
    user: targetEnv.SOURCE_DB_USERNAME || sourceEnv.DB_USERNAME || 'diegolimones',
    password:
      (targetEnv.SOURCE_DB_PASSWORD ?? sourceEnv.DB_PASSWORD) || undefined,
    database: targetEnv.SOURCE_DB_NAME || sourceEnv.DB_NAME || 'gym_db',
    ssl:
      (targetEnv.SOURCE_DB_SSL || sourceEnv.DB_SSL) === 'true'
        ? { rejectUnauthorized: false }
        : false,
  };
}

function buildTargetConfig() {
  if (targetEnv.TARGET_DATABASE_URL || targetEnv.DATABASE_URL) {
    return {
      connectionString: (
        targetEnv.TARGET_DATABASE_URL || targetEnv.DATABASE_URL
      ).trim(),
      ssl:
        targetEnv.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    };
  }

  return {
    host: targetEnv.DB_HOST || 'localhost',
    port: Number(targetEnv.DB_PORT || 5432),
    user: targetEnv.DB_USERNAME || 'diegolimones',
    password: targetEnv.DB_PASSWORD || undefined,
    database: targetEnv.DB_NAME || 'users_db',
    ssl: targetEnv.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  };
}

async function ensureTargetDatabaseExists(targetConfig) {
  if (targetConfig.connectionString) return;
  const dbName = sanitizeIdent(targetConfig.database, 'users_db');
  const adminClient = new Client({
    host: targetConfig.host,
    port: targetConfig.port,
    user: targetConfig.user,
    password: targetConfig.password,
    database: 'postgres',
    ssl: targetConfig.ssl,
  });

  await adminClient.connect();
  try {
    const existsRes = await adminClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName],
    );
    if (existsRes.rowCount === 0) {
      await adminClient.query(`CREATE DATABASE "${dbName}"`);
      console.log(`[migrate] Created database "${dbName}"`);
    } else {
      console.log(`[migrate] Database "${dbName}" already exists`);
    }
  } finally {
    await adminClient.end();
  }
}

async function main() {
  const sourceConfig = buildSourceConfig();
  const targetConfig = buildTargetConfig();
  const sourceSchema = sanitizeIdent(targetEnv.SOURCE_DB_SCHEMA, 'public');
  const targetSchema = sanitizeIdent(targetEnv.DB_SCHEMA, 'public');

  await ensureTargetDatabaseExists(targetConfig);

  const sourceClient = new Client(sourceConfig);
  const targetClient = new Client(targetConfig);

  await sourceClient.connect();
  await targetClient.connect();

  try {
    await targetClient.query(`CREATE SCHEMA IF NOT EXISTS "${targetSchema}"`);
    await targetClient.query(`
      CREATE TABLE IF NOT EXISTS "${targetSchema}".roles (
        id SERIAL PRIMARY KEY,
        role VARCHAR NOT NULL
      );
    `);
    await targetClient.query(`
      CREATE TABLE IF NOT EXISTS "${targetSchema}".users (
        id UUID PRIMARY KEY,
        email VARCHAR NOT NULL UNIQUE,
        password VARCHAR NOT NULL,
        first_name VARCHAR NOT NULL,
        last_name VARCHAR NOT NULL,
        role_id INTEGER NOT NULL REFERENCES "${targetSchema}".roles(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const rolesTableCheck = await sourceClient.query(
      'SELECT to_regclass($1) AS tbl',
      [`${sourceSchema}.roles`],
    );
    const usersTableCheck = await sourceClient.query(
      'SELECT to_regclass($1) AS tbl',
      [`${sourceSchema}.users`],
    );

    let copiedRoles = 0;
    let copiedUsers = 0;

    await targetClient.query('BEGIN');
    try {
      if (rolesTableCheck.rows[0]?.tbl) {
        const { rows: roles } = await sourceClient.query(
          `SELECT id, role FROM "${sourceSchema}".roles ORDER BY id ASC`,
        );
        for (const r of roles) {
          const res = await targetClient.query(
            `INSERT INTO "${targetSchema}".roles (id, role) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
            [r.id, r.role],
          );
          copiedRoles += res.rowCount ?? 0;
        }
        await targetClient.query(`
          SELECT setval(
            pg_get_serial_sequence('"${targetSchema}".roles', 'id'),
            COALESCE((SELECT MAX(id) FROM "${targetSchema}".roles), 1),
            (SELECT COUNT(*) > 0 FROM "${targetSchema}".roles)
          )
        `);
      }

      if (usersTableCheck.rows[0]?.tbl) {
        const { rows: users } = await sourceClient.query(
          `SELECT id, email, password, first_name, last_name, role_id, created_at, updated_at FROM "${sourceSchema}".users`,
        );
        for (const u of users) {
          const res = await targetClient.query(
            `INSERT INTO "${targetSchema}".users (id, email, password, first_name, last_name, role_id, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (id) DO NOTHING`,
            [
              u.id,
              u.email,
              u.password,
              u.first_name,
              u.last_name,
              u.role_id,
              u.created_at,
              u.updated_at,
            ],
          );
          copiedUsers += res.rowCount ?? 0;
        }
      }

      await targetClient.query('COMMIT');
    } catch (error) {
      await targetClient.query('ROLLBACK');
      throw error;
    }

    const fkRes = await sourceClient.query(
      `
      SELECT tc.table_schema, tc.table_name, tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
       AND tc.constraint_schema = ccu.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = $1
        AND ccu.table_schema = $1
        AND ccu.table_name = 'users'
      `,
      [sourceSchema],
    );

    const droppedFks = [];
    for (const row of fkRes.rows) {
      const schemaName = sanitizeIdent(row.table_schema, sourceSchema);
      const tableName = sanitizeIdent(row.table_name, '');
      const constraintName = row.constraint_name.replace(/"/g, '""');
      await sourceClient.query(
        `ALTER TABLE "${schemaName}"."${tableName}" DROP CONSTRAINT IF EXISTS "${constraintName}"`,
      );
      droppedFks.push(`${schemaName}.${tableName}.${row.constraint_name}`);
    }

    console.log(
      `[migrate] Migrated ${copiedRoles} new role(s) and ${copiedUsers} new user(s) into ${targetSchema}.`,
    );
    if (droppedFks.length > 0) {
      console.log(
        `[migrate] Dropped ${droppedFks.length} legacy FK constraint(s) referencing ${sourceSchema}.users:`,
      );
      for (const fk of droppedFks) {
        console.log(`  - ${fk}`);
      }
    } else {
      console.log(
        `[migrate] No legacy FK constraints referencing ${sourceSchema}.users were found.`,
      );
    }
    console.log(
      `[migrate] Legacy "${sourceSchema}.users" and "${sourceSchema}.roles" tables were preserved as backup.`,
    );
  } finally {
    await sourceClient.end();
    await targetClient.end();
  }
}

main().catch((err) => {
  console.error('[migrate] Error:', err);
  process.exit(1);
});
