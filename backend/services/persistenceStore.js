import { Pool } from 'pg';

function normalizeMode(raw = '') {
  const mode = String(raw || '').trim().toLowerCase();
  if (mode === 'postgres' || mode === 'pg') return 'postgres';
  return 'file';
}

function envBool(name, fallback = false) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

export function createPersistenceStore(config = {}) {
  const mode = normalizeMode(config.mode || process.env.KITE_PERSISTENCE_MODE || '');
  const databaseUrl = String(config.databaseUrl || process.env.DATABASE_URL || '').trim();
  const enabled = mode === 'postgres' || Boolean(databaseUrl);
  const sslEnabled = envBool('KITE_PG_SSL', false);
  const sslRejectUnauthorized = envBool('KITE_PG_SSL_REJECT_UNAUTHORIZED', false);

  let pool = null;
  let connected = false;
  let lastError = '';

  function setError(error) {
    const reason = String(error?.message || error || '').trim();
    lastError = reason || 'unknown persistence error';
    connected = false;
  }

  async function init() {
    if (!enabled) return;
    try {
      pool = new Pool({
        connectionString: databaseUrl || undefined,
        ssl: sslEnabled ? { rejectUnauthorized: sslRejectUnauthorized } : false
      });

      await pool.query(`
        CREATE TABLE IF NOT EXISTS app_state_documents (
          state_key TEXT PRIMARY KEY,
          payload JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      connected = true;
      lastError = '';
    } catch (error) {
      setError(error);
      throw error;
    }
  }

  async function getDocument(stateKey = '') {
    if (!connected || !pool) return null;
    const key = String(stateKey || '').trim();
    if (!key) return null;
    try {
      const result = await pool.query(
        'SELECT payload FROM app_state_documents WHERE state_key = $1 LIMIT 1',
        [key]
      );
      if (!result.rows?.length) return null;
      return result.rows[0]?.payload ?? null;
    } catch (error) {
      setError(error);
      return null;
    }
  }

  async function hasDocument(stateKey = '') {
    if (!connected || !pool) return false;
    const key = String(stateKey || '').trim();
    if (!key) return false;
    try {
      const result = await pool.query(
        'SELECT 1 FROM app_state_documents WHERE state_key = $1 LIMIT 1',
        [key]
      );
      return Boolean(result.rows?.length);
    } catch (error) {
      setError(error);
      return false;
    }
  }

  async function setDocument(stateKey = '', payload = null) {
    if (!connected || !pool) return false;
    const key = String(stateKey || '').trim();
    if (!key) return false;
    try {
      await pool.query(
        `
          INSERT INTO app_state_documents (state_key, payload, updated_at)
          VALUES ($1, $2::jsonb, NOW())
          ON CONFLICT (state_key)
          DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
        `,
        [key, JSON.stringify(payload ?? null)]
      );
      return true;
    } catch (error) {
      setError(error);
      return false;
    }
  }

  async function close() {
    try {
      if (pool) {
        await pool.end();
      }
    } catch {
      // ignore pool shutdown errors
    } finally {
      pool = null;
      connected = false;
    }
  }

  function info() {
    return {
      mode: enabled ? 'postgres' : 'file',
      enabled,
      connected,
      lastError: lastError || '',
      table: enabled ? 'app_state_documents' : '',
      ssl: enabled ? sslEnabled : false
    };
  }

  return {
    init,
    getDocument,
    hasDocument,
    setDocument,
    close,
    info,
    isEnabled: () => enabled,
    isConnected: () => connected
  };
}
