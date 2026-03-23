/**
 * Hero PBX bridge: phonebook XML, live calls, recordings, optional Hero portal API (subscriber status).
 * Last modified: 2026-03-24 — Get-Subscriber-Status merged into /api/live-status (HERO_API_TOKEN).
 */
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');
const xml2js = require('xml2js');

/** POST JSON to portal; token from Hero (same family as contacts.php link). */
const HERO_API_URL = (process.env.HERO_API_URL || 'https://portal.hero.co.nz/api/').replace(/\/?$/, '/');
const HERO_API_TOKEN = process.env.HERO_API_TOKEN || '';

let subscriberStatusCache = { data: null, fetchedAt: 0 };
const SUBSCRIBER_STATUS_TTL_MS = 10000;

/**
 * Hero Get-Subscriber-Status: maps SIP login / number -> "1" when online.
 * @returns {Promise<Record<string, string>|null>} null if token not configured; object (maybe empty) otherwise
 */
async function fetchSubscriberStatus() {
  if (!HERO_API_TOKEN) return null;

  const now = Date.now();
  if (subscriberStatusCache.data != null && now - subscriberStatusCache.fetchedAt < SUBSCRIBER_STATUS_TTL_MS) {
    return subscriberStatusCache.data;
  }

  try {
    const res = await axios.post(
      HERO_API_URL,
      {
        token: HERO_API_TOKEN,
        action: 'Get-Subscriber-Status',
        context: 'voice',
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 12000 }
    );
    const body = res.data;
    if (body && String(body.Result) === '1' && body.Data && typeof body.Data === 'object') {
      subscriberStatusCache = { data: body.Data, fetchedAt: Date.now() };
      return subscriberStatusCache.data;
    }
    console.warn('Get-Subscriber-Status: unexpected payload', body?.Status, body?.Message);
    subscriberStatusCache.fetchedAt = Date.now();
    return subscriberStatusCache.data != null ? subscriberStatusCache.data : {};
  } catch (e) {
    console.error('Get-Subscriber-Status failed:', e.message);
    subscriberStatusCache.fetchedAt = Date.now();
    return subscriberStatusCache.data != null ? subscriberStatusCache.data : {};
  }
}

const app = express();
app.use(bodyParser.json());
app.use(cors());

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

let phonebookCache = {};
const CONTACTS_URL = "https://portal.hero.co.nz/api/contacts.php?l=6LIwSI1NpVIU3Jrl6dV1D7*2FdgdAOmZgkxqhjOxOFaebqbJTfbwW2zXMUekqinF6bd0UWuUq68zzaLiqlWpc*2FLQ*3D*3D";

async function updatePhonebook() {
    try {
        const response = await axios.get(CONTACTS_URL);
        const parser = new xml2js.Parser();
        parser.parseString(response.data, (err, result) => {
            if (err) return;
            const newBook = {};
            if (result.contacts && result.contacts.contact) {
                result.contacts.contact.forEach(c => {
                    const attr = c.$;
                    const name = (attr.name || '').trim();
                    if (!name) return;
                    const type = name.includes('Queue') ? 'queue' : 'agent';
                    const phone = attr.phone ? String(attr.phone).trim() : '';
                    const num = attr.number ? String(attr.number).trim() : '';
                    const loginAttr = attr.login ? String(attr.login).trim() : '';
                    const extensionAttr = attr.extension ? String(attr.extension).trim() : '';
                    // Full SIP/WebRTC user: phonebook may expose it as phone, login, or extension; short ext stays in number.
                    const fullLogin = phone || loginAttr || extensionAttr || '';
                    const key = fullLogin || num;
                    if (!key) return;
                    newBook[key] = {
                        name,
                        type,
                        extension: fullLogin || num,
                        ...(fullLogin && num && fullLogin !== num ? { shortNumber: num } : {})
                    };
                });
                phonebookCache = newBook;
                console.log(`✅ Phonebook Synced: ${Object.keys(newBook).length} entries.`);
            }
        });
    } catch (e) { console.error("Sync fail:", e.message); }
}

updatePhonebook();
setInterval(updatePhonebook, 60 * 60 * 1000);

app.post('/hero-webhook', async (req, res) => {
    const { state, id, from, to, direction, duration, voiceuri } = req.body;
    try {
        if (state === 'ringing') {
            await pool.query(
                `INSERT INTO active_calls (call_id, direction, caller_number, callee_number, status, start_time)
                 VALUES ($1, $2, $3, $4, 'ringing', NOW()) ON CONFLICT (call_id) DO NOTHING`,
                [id, direction || 'inbound', from, to]
            );
        } else if (state === 'answered') {
            await pool.query(`UPDATE active_calls SET status = 'answered', connect_time = NOW() WHERE call_id = $1`, [id]);
        } else if (state === 'ended') {
            // FIXED: Added ended_at column to the INSERT
            await pool.query(
                `INSERT INTO call_logs (call_id, caller_number, callee_number, direction, duration, recording_url, ended_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
                [id, from, to, direction, duration, voiceuri]
            );
            await pool.query(`DELETE FROM active_calls WHERE call_id = $1`, [id]);
        }
        res.json({ result: "1", status: "success" });
    } catch (err) { res.status(500).send("DB Error"); }
});

app.get('/api/live-status', async (req, res) => {
    try {
        const activeCalls = await pool.query(`SELECT * FROM active_calls ORDER BY start_time DESC`);
        const subscriberStatus = await fetchSubscriberStatus();
        const payload = {
            calls: activeCalls.rows,
            directory: phonebookCache,
            stats: {
                active_count: activeCalls.rows.filter(c => c.status === 'answered').length,
                queue_count: activeCalls.rows.filter(c => c.status === 'ringing').length
            }
        };
        if (subscriberStatus != null) payload.subscriberStatus = subscriberStatus;
        res.json(payload);
    } catch (e) { res.status(500).send("Error"); }
});

app.get('/api/recordings', async (req, res) => {
    try {
        // Querying based on the confirmed table structure
        const result = await pool.query(`SELECT * FROM call_logs ORDER BY ended_at DESC LIMIT 50`);
        res.json(result.rows);
    } catch (e) { res.status(500).send("Error"); }
});

app.listen(process.env.PORT || 3002, () => console.log(`🚀 Hero Service running...`));