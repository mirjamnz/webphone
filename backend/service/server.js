require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');
const xml2js = require('xml2js');

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
                    if (attr.number) newBook[attr.number] = { name: attr.name, type: attr.name.includes("Queue") ? "queue" : "agent" };
                    if (attr.phone) newBook[attr.phone] = { name: attr.name, type: "agent" };
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
        res.json({
            calls: activeCalls.rows,
            directory: phonebookCache,
            stats: {
                active_count: activeCalls.rows.filter(c => c.status === 'answered').length,
                queue_count: activeCalls.rows.filter(c => c.status === 'ringing').length
            }
        });
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