const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const isPostgres = process.env.DATABASE_URL &&
      (process.env.DATABASE_URL.startsWith('postgres://') || process.env.DATABASE_URL.startsWith('postgresql://'));

let pgPool = null;
let sqliteDb = null;

if (isPostgres) {
      console.log('Database configuration: PostgreSQL');
      pgPool = new Pool({
              connectionString: process.env.DATABASE_URL,
              ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
      });
} else {
      // Only require sqlite3 when not using PostgreSQL (local dev only)
  console.log('Database configuration: SQLite (local)');
      const sqlite3 = require('sqlite3').verbose();
      const dbPath = path.resolve(__dirname, '../../database.sqlite');
      sqliteDb = new sqlite3.Database(dbPath, (err) => {
              if (err) {
                        console.error('Failed to open SQLite database:', err.message);
              } else {
                        console.log(`SQLite database opened successfully at ${dbPath}`);
              }
      });
}

function pgToSqliteQuery(sql, params = []) {
      let sqliteSql = sql;
      sqliteSql = sqliteSql.replace(/\$(\d+)/g, '?');
      return sqliteSql;
}

function query(sql, params = []) {
      return new Promise((resolve, reject) => {
              if (isPostgres) {
                        pgPool.query(sql, params, (err, res) => {
                                    if (err) return reject(err);
                                    resolve({ rows: res.rows });
                        });
              } else {
                        const sqliteSql = pgToSqliteQuery(sql, params);
                        const sqliteParams = params.map(param => {
                                    if (Array.isArray(param)) return JSON.stringify(param);
                                    if (param !== null && typeof param === 'object') return JSON.stringify(param);
                                    return param;
                        });

                const isSelect = sqliteSql.trim().toUpperCase().startsWith('SELECT');
                        if (isSelect) {
                                    sqliteDb.all(sqliteSql, sqliteParams, (err, rows) => {
                                                  if (err) return reject(err);
                                                  const parsedRows = rows.map(row => {
                                                                  const newRow = { ...row };
                                                                  for (const key in newRow) {
                                                                                    const val = newRow[key];
                                                                                    if (typeof val === 'string') {
                                                                                                        if ((val.startsWith('[') && val.endsWith(']')) || (val.startsWith('{') && val.endsWith('}'))) {
                                                                                                                              try { newRow[key] = JSON.parse(val); } catch (e) {}
                                                                                                            }
                                                                                        }
                                                                  }
                                                                  return newRow;
                                                  });
                                                  resolve({ rows: parsedRows });
                                    });
                        } else {
                                    sqliteDb.run(sqliteSql, sqliteParams, function(err) {
                                                  if (err) return reject(err);
                                                  resolve({ rows: [], lastID: this.lastID, changes: this.changes });
                                    });
                        }
              }
      });
}

async function initDb() {
      if (isPostgres) {
              console.log('Initializing PostgreSQL database tables...');
              try {
                        const initSqlPath = path.resolve(__dirname, '../../migrations/init.sql');
                        const sql = fs.readFileSync(initSqlPath, 'utf8');
                        await pgPool.query(sql);

                try {
                            await pgPool.query(`
                                      ALTER TABLE users ADD COLUMN IF NOT EXISTS provider VARCHAR(50) DEFAULT 'EMAIL';
                                                ALTER TABLE generations ADD COLUMN IF NOT EXISTS planning_mode VARCHAR(20) DEFAULT 'Parent';
                                                          ALTER TABLE generations ADD COLUMN IF NOT EXISTS player_weight DECIMAL(5,1);
                                                                    ALTER TABLE generations ADD COLUMN IF NOT EXISTS player_experience VARCHAR(50);
                                                                              ALTER TABLE generations ADD COLUMN IF NOT EXISTS user_id VARCHAR(128) REFERENCES users(id);
                                                                                        ALTER TABLE generations ADD COLUMN IF NOT EXISTS player_name VARCHAR(100);
                                                                                                `);
                } catch (colErr) {
                            console.warn('Postgres alter columns skipped or failed:', colErr.message);
                }

                console.log('PostgreSQL database initialized.');
              } catch (err) {
                        console.error('Failed to initialize PostgreSQL:', err.message);
                        throw err;
              }
      } else {
              console.log('Initializing SQLite database tables...');
              const createTables = `
                    CREATE TABLE IF NOT EXISTS users (
                            id TEXT PRIMARY KEY,
                                    email TEXT UNIQUE NOT NULL,
                                            name TEXT,
                                                    avatar TEXT,
                                                            role TEXT DEFAULT 'Parent',
                                                                    provider TEXT DEFAULT 'EMAIL',
                                                                            created_at TEXT DEFAULT CURRENT_TIMESTAMP
                                                                                  );
                                                                                        CREATE TABLE IF NOT EXISTS generations (
                                                                                                id TEXT PRIMARY KEY,
                                                                                                        sport TEXT NOT NULL,
                                                                                                                age INTEGER NOT NULL CHECK (age BETWEEN 6 AND 25),
                                                                                                                        height REAL,
                                                                                                                                height_unit TEXT DEFAULT 'cm',
                                                                                                                                        player_level TEXT,
                                                                                                                                                current_equipment TEXT NOT NULL,
                                                                                                                                                        budget_min INTEGER,
                                                                                                                                                                budget_max INTEGER,
                                                                                                                                                                        goals TEXT,
                                                                                                                                                                                coach_name TEXT,
                                                                                                                                                                                        prompt_version TEXT,
                                                                                                                                                                                                ai_response TEXT,
                                                                                                                                                                                                        response_time_ms INTEGER,
                                                                                                                                                                                                                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                                                                                                                                                                                                                        is_deleted INTEGER DEFAULT 0,
                                                                                                                                                                                                                                planning_mode TEXT DEFAULT 'Parent',
                                                                                                                                                                                                                                        player_weight REAL,
                                                                                                                                                                                                                                                player_experience TEXT,
                                                                                                                                                                                                                                                        user_id TEXT REFERENCES users(id),
                                                                                                                                                                                                                                                                player_name TEXT
                                                                                                                                                                                                                                                                      );
                                                                                                                                                                                                                                                                            CREATE TABLE IF NOT EXISTS feedback (
                                                                                                                                                                                                                                                                                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                                                                                                                                                                                                                                                            generation_id TEXT REFERENCES generations(id),
                                                                                                                                                                                                                                                                                                    rating INTEGER CHECK (rating BETWEEN 1 AND 5),
                                                                                                                                                                                                                                                                                                            thumbs TEXT CHECK (thumbs IN ('up', 'down')),
                                                                                                                                                                                                                                                                                                                    comment TEXT,
                                                                                                                                                                                                                                                                                                                            created_at TEXT DEFAULT CURRENT_TIMESTAMP
                                                                                                                                                                                                                                                                                                                                  );
                                                                                                                                                                                                                                                                                                                                        CREATE TABLE IF NOT EXISTS templates (
                                                                                                                                                                                                                                                                                                                                                id TEXT PRIMARY KEY,
                                                                                                                                                                                                                                                                                                                                                        label TEXT, emoji TEXT, color TEXT, sport TEXT,
                                                                                                                                                                                                                                                                                                                                                                age INTEGER, height REAL, height_unit TEXT DEFAULT 'cm',
                                                                                                                                                                                                                                                                                                                                                                        player_level TEXT, current_equipment TEXT,
                                                                                                                                                                                                                                                                                                                                                                                budget_min INTEGER, budget_max INTEGER, goals TEXT,
                                                                                                                                                                                                                                                                                                                                                                                        is_active INTEGER DEFAULT 1
                                                                                                                                                                                                                                                                                                                                                                                              );
                                                                                                                                                                                                                                                                                                                                                                                                    CREATE INDEX IF NOT EXISTS idx_generations_sport ON generations(sport);
                                                                                                                                                                                                                                                                                                                                                                                                          CREATE INDEX IF NOT EXISTS idx_generations_created_at ON generations(created_at);
                                                                                                                                                                                                                                                                                                                                                                                                                CREATE INDEX IF NOT EXISTS idx_feedback_generation_id ON feedback(generation_id);
                                                                                                                                                                                                                                                                                                                                                                                                                    `;

        return new Promise((resolve, reject) => {
                  sqliteDb.exec(createTables, (err) => {
                              if (err) { console.error('Failed to initialize SQLite tables:', err.message); return reject(err); }
                              console.log('SQLite database initialized.');
                              resolve();
                  });
        });
      }
}

module.exports = { query, initDb, isPostgres };
