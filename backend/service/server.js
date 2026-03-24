/**
 * Hero PBX bridge: phonebook XML, live calls, recordings, optional Hero portal API (subscriber status).
 * Last modified: 2026-03-24 — live-status subscriberStatus as { ok, onlineByNumber } for dashboard parsing.
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
/** Hero JSON action to map PBX extension → auth SIP login (portal “Login: 8010614000xx”). Override if your tenant uses another name. */
const HERO_SUBSCRIBER_INFO_ACTION = process.env.HERO_SUBSCRIBER_INFO_ACTION || 'Get-Subscriber-Info';

let subscriberStatusCache = { data: null, fetchedAt: 0 };
const SUBSCRIBER_STATUS_TTL_MS = 10000;

const FULL_LOGIN_MIN_DIGITS = 11;
function looksLikeHeroAuthLogin(s) {
  return typeof s === 'string' && /^\d+$/.test(s) && s.length >= FULL_LOGIN_MIN_DIGITS;
}

/** ext string → { login: string|null, at: number, failUntil?: number } */
const extensionLoginCache = new Map();
const EXTENSION_LOGIN_TTL_MS = 6 * 60 * 60 * 1000;
const EXTENSION_LOGIN_FAIL_TTL_MS = 15 * 60 * 1000;

/**
 * Short PBX extension for Hero info API (2–6 digits). Prefer explicit shortNumber from phonebook.
 */
function pickShortExtensionForInfoApi(mapKey, entry) {
  if (!entry || entry.type !== 'agent') return '';
  const shortNum = entry.shortNumber != null ? String(entry.shortNumber).trim() : '';
  if (shortNum && /^\d{2,6}$/.test(shortNum)) return shortNum;
  const ext = entry.extension != null ? String(entry.extension).trim() : '';
  if (ext && /^\d{2,6}$/.test(ext) && !looksLikeHeroAuthLogin(ext)) return ext;
  const k = String(mapKey || '').trim();
  if (k && /^\d{2,6}$/.test(k) && !looksLikeHeroAuthLogin(k)) return k;
  return '';
}

function entryAlreadyHasAuthLogin(mapKey, entry) {
  if (!entry) return false;
  if (entry.authLogin && looksLikeHeroAuthLogin(String(entry.authLogin))) return true;
  if (looksLikeHeroAuthLogin(String(entry.extension || ''))) return true;
  if (looksLikeHeroAuthLogin(String(mapKey || ''))) return true;
  return false;
}

function extractLoginFromSubscriberInfoBody(body) {
  if (!body || String(body.Result) !== '1') return null;
  const d = body.Data;
  if (d == null) return null;
  if (typeof d === 'string') {
    const s = d.trim();
    return looksLikeHeroAuthLogin(s) ? s : null;
  }
  if (typeof d !== 'object') return null;
  const preferredKeys = [
    'AuthLogin',
    'Login',
    'login',
    'SIPLogin',
    'sip_login',
    'UserLogin',
    'ExtensionLogin',
    'WebRTCLogin',
    'SipUser',
  ];
  for (const k of preferredKeys) {
    if (d[k] == null) continue;
    const s = String(d[k]).trim();
    if (looksLikeHeroAuthLogin(s)) return s;
  }
  for (const v of Object.values(d)) {
    if (typeof v === 'string' && looksLikeHeroAuthLogin(v.trim())) return v.trim();
  }
  return null;
}

/**
 * Fetches and caches SIP auth login for a numeric extension (e.g. 7442 → 801061400036).
 * Use case: Get-Subscriber-Status keys are logins; contacts XML often only has short ext.
 */
async function fetchAndCacheExtensionLogin(ext) {
  if (!HERO_API_TOKEN || !ext) return null;
  const now = Date.now();
  const prev = extensionLoginCache.get(ext);
  if (prev && prev.login && now - prev.at < EXTENSION_LOGIN_TTL_MS) return prev.login;
  if (prev && prev.failUntil && now < prev.failUntil) return null;

  const bodies = [
    { token: HERO_API_TOKEN, action: HERO_SUBSCRIBER_INFO_ACTION, context: 'voice', Extension: ext },
    { token: HERO_API_TOKEN, action: HERO_SUBSCRIBER_INFO_ACTION, context: 'voice', Number: ext },
  ];
  try {
    for (const json of bodies) {
      const res = await axios.post(HERO_API_URL, json, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });
      const login = extractLoginFromSubscriberInfoBody(res.data);
      if (login) {
        extensionLoginCache.set(ext, { login, at: now });
        return login;
      }
    }
    console.warn(`Hero ${HERO_SUBSCRIBER_INFO_ACTION}: no parseable login for extension`, ext);
  } catch (e) {
    console.warn(`Hero ${HERO_SUBSCRIBER_INFO_ACTION} failed for ext ${ext}:`, e.message);
  }
  extensionLoginCache.set(ext, { login: null, at: now, failUntil: now + EXTENSION_LOGIN_FAIL_TTL_MS });
  return null;
}

/**
 * Deep-clone directory and attach authLogin from cache or Hero API so dashboard probes match Get-Subscriber-Status.
 */
async function buildEnrichedDirectoryForLiveStatus(directory) {
  const clone = JSON.parse(JSON.stringify(directory || {}));
  const toResolve = new Set();
  for (const [k, v] of Object.entries(clone)) {
    if (!v || v.type !== 'agent') continue;
    if (entryAlreadyHasAuthLogin(k, v)) continue;
    const ext = pickShortExtensionForInfoApi(k, v);
    if (!ext) continue;
    const prev = extensionLoginCache.get(ext);
    const now = Date.now();
    if (prev && prev.login && now - prev.at < EXTENSION_LOGIN_TTL_MS) {
      clone[k] = { ...v, authLogin: prev.login };
      continue;
    }
    if (!prev || !prev.failUntil || now >= prev.failUntil) toResolve.add(ext);
  }

  const list = [...toResolve];
  const batchSize = 8;
  for (let i = 0; i < list.length; i += batchSize) {
    const chunk = list.slice(i, i + batchSize);
    await Promise.all(chunk.map((ext) => fetchAndCacheExtensionLogin(ext)));
  }

  for (const [k, v] of Object.entries(clone)) {
    if (!v || v.type !== 'agent' || v.authLogin) continue;
    if (entryAlreadyHasAuthLogin(k, v)) continue;
    const ext = pickShortExtensionForInfoApi(k, v);
    if (!ext) continue;
    const cached = extensionLoginCache.get(ext);
    if (cached && cached.login) clone[k] = { ...v, authLogin: cached.login };
  }
  return clone;
}

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
                    const authLoginRaw =
                        attr.authlogin ||
                        attr.auth_login ||
                        attr.auth ||
                        attr.sipuser ||
                        attr.sip_user ||
                        attr.username ||
                        attr.user ||
                        '';
                    const authLogin = authLoginRaw ? String(authLoginRaw).trim() : '';
                    const callerIdRaw = attr.callerid || attr.caller_id || attr.cli || '';
                    const callerId = callerIdRaw ? String(callerIdRaw).trim() : '';
                    // Full SIP/WebRTC user: phonebook may expose it as phone, login, or extension; short ext stays in number.
                    const fullLogin = phone || loginAttr || extensionAttr || '';
                    const key = fullLogin || num;
                    if (!key) return;
                    newBook[key] = {
                        name,
                        type,
                        extension: fullLogin || num,
                        ...(fullLogin && num && fullLogin !== num ? { shortNumber: num } : {}),
                        ...(authLogin ? { authLogin } : {}),
                        ...(callerId ? { callerId } : {}),
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
        let directoryPayload = phonebookCache;
        if (HERO_API_TOKEN) {
            try {
                directoryPayload = await buildEnrichedDirectoryForLiveStatus(phonebookCache);
            } catch (enrichErr) {
                console.error('Directory enrich (extension→login) failed:', enrichErr.message);
            }
        }
        const payload = {
            calls: activeCalls.rows,
            directory: directoryPayload,
            stats: {
                active_count: activeCalls.rows.filter(c => c.status === 'answered').length,
                queue_count: activeCalls.rows.filter(c => c.status === 'ringing').length
            }
        };
        // Dashboard expects { ok, onlineByNumber } so the UI does not confuse wrapper keys with SIP ids.
        if (subscriberStatus != null) {
            payload.subscriberStatus = { ok: true, onlineByNumber: subscriberStatus };
        }
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