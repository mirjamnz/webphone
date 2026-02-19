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

// --- DATABASE CONNECTION ---
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// --- PHONEBOOK CACHE ---
let phonebookCache = {};
const CONTACTS_URL = "https://portal.hero.co.nz/api/contacts.php?l=6LIwSI1NpVIU3Jrl6dV1D7*2FdgdAOmZgkxqhjOxOFaebqbJTfbwW2zXMUekqinF6bd0UWuUq68zzaLiqlWpc*2FLQ*3D*3D";

// Function to update the phonebook from Hero's XML
async function updatePhonebook() {
    try {
        console.log("📖 Syncing Phonebook from Hero...");
        const response = await axios.get(CONTACTS_URL);
        const parser = new xml2js.Parser();
        
        parser.parseString(response.data, (err, result) => {
            if (err) {
                console.error("XML Parse Error:", err);
                return;
            }

            const newBook = {};
            
            // The XML structure is <contacts><contact name="..." number="..." ... /></contacts>
            if (result.contacts && result.contacts.contact) {
                result.contacts.contact.forEach(c => {
                    const attr = c.$; // xml2js puts attributes in '$'
                    
                    // Map "801..." numbers to Names
                    if (attr.number) {
                        newBook[attr.number] = { 
                            name: attr.name, 
                            type: attr.name.includes("Queue") || attr.lastname === "Sales" ? "queue" : "agent" 
                        };
                    }
                    
                    // Map "3001" extensions to Names (for internal calls)
                    if (attr.phone) {
                        newBook[attr.phone] = { 
                            name: attr.name, 
                            type: "agent" 
                        };
                    }
                });
                phonebookCache = newBook;
                console.log(`✅ Phonebook Synced! Loaded ${Object.keys(newBook).length} entries.`);
            }
        });
    } catch (error) {
        console.error("Failed to fetch contacts:", error.message);
    }
}

// Run sync on startup and then every 60 minutes
updatePhonebook();
setInterval(updatePhonebook, 60 * 60 * 1000);


// --- WEBHOOK LISTENER ---
app.post('/hero-webhook', async (req, res) => {
    const { state, id, from, to, direction, duration, voiceuri } = req.body;
    console.log(`[Webhook] ${state} | ID: ${id}`);

    try {
        if (state === 'ringing') {
            await pool.query(
                `INSERT INTO active_calls (call_id, direction, caller_number, callee_number, status, start_time)
                 VALUES ($1, $2, $3, $4, 'ringing', NOW())
                 ON CONFLICT (call_id) DO NOTHING`,
                [id, direction || 'inbound', from, to]
            );
        } 
        else if (state === 'answered') {
            await pool.query(
                `UPDATE active_calls SET status = 'answered', connect_time = NOW() WHERE call_id = $1`,
                [id]
            );
        } 
        else if (state === 'ended') {
            await pool.query(
                `INSERT INTO call_logs (call_id, caller_number, callee_number, direction, duration, recording_url)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [id, from, to, direction, duration, voiceuri]
            );
            await pool.query(`DELETE FROM active_calls WHERE call_id = $1`, [id]);
        }
        res.json({ result: "1", status: "success" });
    } catch (err) {
        console.error("DB Error:", err);
        res.status(500).send("Database Error");
    }
});

// --- DASHBOARD API ---
app.get('/api/live-status', async (req, res) => {
    try {
        const activeCalls = await pool.query(`SELECT * FROM active_calls ORDER BY start_time DESC`);
        
        // Return calls + the cached phonebook
        res.json({
            calls: activeCalls.rows,
            directory: phonebookCache, // <--- Sending the XML data to frontend
            stats: {
                active_count: activeCalls.rows.filter(c => c.status === 'answered').length,
                queue_count: activeCalls.rows.filter(c => c.status === 'ringing').length
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching data");
    }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
    console.log(`🚀 Service running on port ${PORT}`);
});