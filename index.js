const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const app = express();
app.use(cors());
app.use(express.json());

// Koneksi PostgreSQL: Railway otomatis set DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Wajib untuk Railway
});

// Inisialisasi tabel saat server mulai
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS activation_codes (
        code TEXT PRIMARY KEY,
        max_devices INTEGER NOT NULL DEFAULT 1
      );
      
      CREATE TABLE IF NOT EXISTS activated_devices (
        id SERIAL PRIMARY KEY,
        code TEXT REFERENCES activation_codes(code) ON DELETE CASCADE,
        device_id TEXT NOT NULL,
        UNIQUE(code, device_id)
      );
    `);
    // Masukkan kode default (jika belum ada)
    await client.query(`
      INSERT INTO activation_codes (code, max_devices)
      VALUES ('AKTIF-2024', 3), ('KODE-RAHASIA', 1)
      ON CONFLICT (code) DO NOTHING;
    `);
    console.log('✅ Database siap.');
  } finally {
    client.release();
  }
}

// Endpoint verifikasi aktivasi
app.post('/api/verify-activation', async (req, res) => {
  const { activationCode, deviceId } = req.body;
  if (!activationCode || !deviceId) {
    return res.status(400).json({ valid: false, message: 'Data tidak lengkap.' });
  }
  try {
    const codeRes = await pool.query('SELECT * FROM activation_codes WHERE code = $1', [activationCode]);
    if (codeRes.rows.length === 0) {
      return res.json({ valid: false, message: 'Kode aktivasi tidak dikenal.' });
    }
    const { max_devices } = codeRes.rows[0];

    const deviceRes = await pool.query(
      'SELECT * FROM activated_devices WHERE code = $1 AND device_id = $2',
      [activationCode, deviceId]
    );
    if (deviceRes.rows.length > 0) {
      return res.json({ valid: true }); // sudah diaktivasi
    }

    const countRes = await pool.query(
      'SELECT COUNT(*) AS count FROM activated_devices WHERE code = $1',
      [activationCode]
    );
    const currentCount = parseInt(countRes.rows[0].count, 10);
    if (currentCount >= max_devices) {
      return res.json({ valid: false, message: 'Kode aktivasi sudah mencapai batas perangkat.' });
    }

    await pool.query('INSERT INTO activated_devices (code, device_id) VALUES ($1, $2)', [activationCode, deviceId]);
    return res.json({ valid: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ valid: false, message: 'Kesalahan server.' });
  }
});

// Endpoint untuk admin menambah kode aktivasi baru
app.post('/api/add-activation-code', async (req, res) => {
  const { adminKey, code, maxDevices } = req.body;
  if (adminKey !== process.env.ADMIN_API_KEY) {
    return res.status(403).json({ success: false, message: 'Kunci admin salah.' });
  }
  if (!code || !maxDevices || isNaN(maxDevices) || maxDevices < 1) {
    return res.status(400).json({ success: false, message: 'Data tidak valid.' });
  }
  try {
    await pool.query(
      'INSERT INTO activation_codes (code, max_devices) VALUES ($1, $2) ON CONFLICT (code) DO UPDATE SET max_devices = $2',
      [code, maxDevices]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Gagal menambah kode.' });
  }
});

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Server berjalan di port ${PORT}`));
}).catch(err => {
  console.error('Gagal inisialisasi database', err);
  process.exit(1);
});