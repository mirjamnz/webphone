/**
 * Asterisk Manager Interface (AMI) Watcher Service
 */

import { Server } from 'socket.io';
import AsteriskManager from 'asterisk-manager';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

const config = {
    ami: {
        host: process.env.AMI_HOST || '127.0.0.1',
        port: parseInt(process.env.AMI_PORT || '5038'),
        username: process.env.AMI_USERNAME || 'node_watcher',
        secret: process.env.AMI_SECRET || 'AKLbdlpbxami2026',
        reconnect: true,
        reconnect_after: 5000
    },
    socket: {
        port: parseInt(process.env.SOCKET_PORT || '3001'),
        cors: {
            origin: ["http://localhost:8111", "https://bdl-pbx.itnetworld.co.nz"], 
            methods: ['GET', 'POST'],
            credentials: true
        }
    }
};

const state = {
    activeCalls: new Map(),
    connected: false
};

const httpServer = http.createServer();
const io = new Server(httpServer, {
    cors: config.socket.cors,
    transports: ['websocket', 'polling']
});

let ami = null;

function connectAMI() {
    try {
        ami = new AsteriskManager(
            config.ami.port, config.ami.host, config.ami.username, config.ami.secret, true
        );

        ami.on('connect', () => {
            state.connected = true;
            log('info', '✅ Connected to Asterisk AMI');
            requestInitialState();
        });

        ami.on('error', (err) => log('error', `❌ AMI Error: ${err.message}`));
        
        // Bind Event Handlers
        ami.on('newchannel', handleNewChannel);
        ami.on('newstate', handleChannelState);
        ami.on('hangup', handleCallHangup);

        // Listen for both case variations to be safe
        ami.on('DialBegin', handleDialBegin); 
        ami.on('dialbegin', handleDialBegin);

    } catch (error) {
        log('error', `Failed to initialize AMI: ${error.message}`);
        setTimeout(connectAMI, 5000);
    }
}

function handleNewChannel(evt) {
    const uid = evt.uniqueid || evt.uniqueid1;
    if (!uid || state.activeCalls.has(uid)) return;

    if (evt.exten === 's' || evt.channel.startsWith('Local/')) return;

    const newCall = {
        uniqueid: uid,
        channel: evt.channel,
        callerid: evt.calleridnum || 'Unknown',
        destination: evt.exten || 'Unknown',
        state: evt.channelstatedesc || 'Ringing',
        startTime: new Date().toISOString(),
        answered: false,
        agent: extractExtension(evt.channel)
    };

    state.activeCalls.set(uid, newCall);
    log('info', `New Call: ${newCall.callerid} -> ${newCall.destination}`);
    broadcastActiveCalls();
}

function handleChannelState(evt) {
    const activeCall = state.activeCalls.get(evt.uniqueid);
    if (!activeCall) return;

    const desc = evt.channelstatedesc;

    if (desc === 'Up' && !activeCall.answered) {
        activeCall.answered = true;
        activeCall.state = 'Answered';
        log('info', `Call Answered: ${activeCall.callerid}`);
    } else {
        activeCall.state = desc;
    }

    broadcastActiveCalls();
}

// Catches when the system starts dialing an agent (e.g. Trunk -> 3001)
function handleDialBegin(evt) {
    // DEBUG: Let's see exactly what Asterisk is sending us
    console.log('DEBUG: DialBegin Event:', JSON.stringify(evt));

    // CHECK BOTH CASES: The library might send lowercase or capitalized keys
    const uid = evt.uniqueid || evt.Uniqueid;
    const destChannel = evt.destchannel || evt.DestChannel;

    if (!uid || !state.activeCalls.has(uid)) {
        // If we can't find the call, we can't link it
        return;
    }

    const destExt = extractExtension(destChannel);
    
    if (destExt) {
        const call = state.activeCalls.get(uid);
        call.agent = destExt; // Updates the call with the correct agent extension
        log('info', `Linked Agent ${destExt} to Call ${uid}`);
        broadcastActiveCalls();
    }
}

function handleCallHangup(evt) {
    if (state.activeCalls.has(evt.uniqueid)) {
        state.activeCalls.delete(evt.uniqueid);
        log('info', `Call Ended: ${evt.uniqueid}`);
        broadcastActiveCalls();
    }
}

function requestInitialState() {
    ami.action({ action: 'CoreShowChannels' }, (err, res) => {
        if (!err && res.events) {
            res.events.forEach(e => {
                if (e.event === 'CoreShowChannel') handleNewChannel(e);
            });
        }
    });
}

function broadcastActiveCalls() {
    io.emit('calls:active', Array.from(state.activeCalls.values()));
}

function extractExtension(channel) {
    if (!channel) return null;
    const match = channel.match(/PJSIP\/(\d+)/);
    return match ? match[1] : null;
}

function log(level, message) {
    console.log(`[${level.toUpperCase()}] ${message}`);
}

// Socket IO Supervisor Actions
io.on('connection', (socket) => {
    log('info', `Dashboard connected: ${socket.id}`);

    socket.on('supervisor:monitor', (data) => handleSpyAction('monitor', data, socket));
    socket.on('supervisor:whisper', (data) => handleSpyAction('whisper', data, socket));
    socket.on('supervisor:barge', (data) => handleSpyAction('barge', data, socket));
});

function handleSpyAction(action, data, socket) {
    const { agentExtension } = data;

    // Guard against undefined extension
    if (!agentExtension || agentExtension === 'undefined') {
        log('error', `Supervisor action aborted: No agent extension provided.`);
        socket.emit('supervisor:error', { action, error: 'No agent identified for this call.' });
        return;
    }

    const prefixMap = { 'monitor': '*1', 'whisper': '*2', 'barge': '*3' };
    const dialStr = `${prefixMap[action] || '*1'}${agentExtension}`;

    log('info', `Supervisor triggering ${action} on ${agentExtension} via ${dialStr}`);

    ami.action({
        action: 'Originate',
        channel: `Local/4001@tenant_28b0d0e2_context`, 
        context: 'tenant_28b0d0e2_context',
        exten: dialStr,
        priority: 1,
        async: true
    }, (err) => {
        if (err) socket.emit('supervisor:error', { action, error: err.message });
        else socket.emit('supervisor:success', { action, agentExtension });
    });
}

httpServer.listen(config.socket.port, () => {
    log('info', `🚀 Watcher running on port ${config.socket.port}`);
    connectAMI();
});