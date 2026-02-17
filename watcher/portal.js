/**
 * PBX Admin Portal - portal.js
 * /home/helper/watcher$ cat portal.js
 */
import express from 'express';
import session from 'express-session';
import pkg from 'pg';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const { Pool } = pkg;

// Config
const PORT = 8111;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database Connection
const pool = new Pool({
    user: process.env.DB_USER || 'asterisk',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'asteriskdb',
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
});

const app = express();

// --- 1. MIDDLEWARE ---
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Session
app.use(session({
    secret: 'pbx_portal_secure_key_2026', 
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 3600000 } // 1 hour session
}));

// --- 2. AUTHENTICATION LOGIC ---

// The "Security Guard" function
const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.loggedIn) {
        return next();
    }
    res.status(401).json({ success: false, error: "Authentication required" });
};

// Login Route
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (username === process.env.Portal_USER && password === process.env.Portal_PASSWORD) {
        req.session.loggedIn = true;
        return res.json({ success: true, message: "Logged in successfully" });
    }
    
    res.status(401).json({ success: false, error: "Invalid credentials" });
});

// --- 3. PROTECTED ROUTES ---

// API: Add New Agent
app.post('/api/agents', isAuthenticated, async (req, res) => {
    const client = await pool.connect();
    try {
        const { extension, password, tenantId } = req.body;
        const tenantContext = `tenant_${tenantId.substring(0, 8)}_context`;

        await client.query('BEGIN');

        // 1. Insert Auth
        await client.query(
            `INSERT INTO ps_auths (id, auth_type, password, username, tenant_id) 
             VALUES ($1, 'userpass', $2, $3, $4)`,
            [`${extension}_auth`, password, extension, tenantId]
        );

        // 2. Insert AOR
        await client.query(
            `INSERT INTO ps_aors (id, max_contacts, remove_existing, tenant_id) 
             VALUES ($1, 5, 'yes', $2)`,
            [extension, tenantId]
        );

        // 3. Insert Endpoint
        await client.query(
            `INSERT INTO ps_endpoints (id, transport, aors, auth, context, disallow, allow, webrtc, tenant_id) 
             VALUES ($1, 'transport-wss', $1, $2, 'from-internal', 'all', 'alaw,ulaw,opus', 'yes', $3)`,
            [extension, `${extension}_auth`, tenantId]
        );

        // 4. Dialplan logic
        await client.query(
            `INSERT INTO extensions (context, exten, priority, app, appdata, tenant_id) 
             VALUES ($1, $2, 1, 'Set', $3, $4)`,
            [tenantContext, extension, `__T_ID=${tenantId}`, tenantId]
        );
        await client.query(
            `INSERT INTO extensions (context, exten, priority, app, appdata, tenant_id) 
             VALUES ($1, $2, 2, 'Dial', $3, $4)`,
            [tenantContext, extension, `PJSIP/${extension},30,g`, tenantId]
        );

        await client.query('COMMIT');
        res.json({ success: true, message: `Agent ${extension} created successfully!` });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
});

app.listen(PORT, () => {
    console.log(`🌍 PBX Portal secured at http://localhost:${PORT}`);
});

