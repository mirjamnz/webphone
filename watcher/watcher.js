/**
 * Asterisk Manager Interface (AMI) Watcher Service
 * Purpose: Monitor call center activity and broadcast to dashboard.
 */

import { Server } from 'socket.io';
import AsteriskManager from 'asterisk-manager';
import dotenv from 'dotenv';
import http from 'http';
import cors from 'cors';

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
    },
    logLevel: process.env.LOG_LEVEL || 'info',
    debug: process.env.DEBUG === 'true'
};

const state = {
    activeCalls: new Map(),
    agents: new Map(),
    queues: new Map(),
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
            io.emit('ami:connected', { timestamp: new Date().toISOString() });
            requestInitialState();
        });

        ami.on('error', (err) => log('error', `❌ AMI Error: ${err.message}`));
        ami.on('disconnect', () => log('warn', '⚠️  Disconnected from AMI'));

        // Bind Events
        ami.on('newchannel', (evt) => handleNewChannel(evt));
        ami.on('newstate', (evt) => handleChannelState(evt));
        ami.on('answer', (evt) => handleCallAnswered(evt));
        ami.on('hangup', (evt) => handleCallHangup(evt));
        ami.on('bridge', (evt) => handleCallBridge(evt));
        
        // Agent/Queue/System Events
        ami.on('agentlogin', (evt) => handleAgentLogin(evt));
        ami.on('agentlogout', (evt) => handleAgentLogout(evt));
        ami.on('agentcalled', (evt) => handleAgentCalled(evt));
        ami.on('queue member added', (evt) => handleQueueMemberAdded(evt));
        ami.on('queue member removed', (evt) => handleQueueMemberRemoved(evt));
        ami.on('peerstatus', (evt) => handlePeerStatus(evt));
        ami.on('extensionstatus', (evt) => handleExtensionStatus(evt));

        // Ping to keep connection alive
        setInterval(() => {
            if (state.connected) ami.action({ action: 'Ping' }, () => {});
        }, 30000);

    } catch (error) {
        log('error', `Failed to initialize AMI: ${error.message}`);
        setTimeout(connectAMI, 5000);
    }
}

function requestInitialState() {
    ami.action({ action: 'CoreShowChannels' }, (err, res) => {
        if (!err && res.events) res.events.forEach(evt => {
            if (evt.event === 'CoreShowChannel') handleNewChannel(evt);
        });
    });
    ami.action({ action: 'QueueStatus' }, (err, res) => {
        if (!err && res.events) res.events.forEach(evt => {
            if (evt.event === 'QueueParams') updateQueueStats(evt);
        });
    });
}

// ========== EVENT HANDLERS ==========

function handleNewChannel(evt) {
    const uniqueid = evt.uniqueid || evt.uniqueid1;
    if (!uniqueid) return;

    if (evt.exten === 's' || evt.destination === 's') return;
    
    if (evt.channel.toLowerCase().includes('herotrunk')) {
        const isInternalRegex = /^(3|4)\d{3}$/;
        const callerID = evt.calleridnum || "";
        if (isInternalRegex.test(callerID)) return;
    }

    if (evt.channel.startsWith('Local/')) return;
    if (state.activeCalls.has(uniqueid)) return;
    if ((!evt.calleridnum || evt.calleridnum === '<unknown>') && (!evt.exten)) return;

    const agentId = extractExtension(evt.channel);
    const dest = evt.exten || evt.destination;
    
    if (agentId) {
        for (const [existingId, existingCall] of state.activeCalls.entries()) {
            if (existingCall.agent === agentId && existingCall.destination === dest) {
                 state.activeCalls.delete(existingId);
                 broadcastActiveCalls(); 
            }
        }
    }

    const call = {
        uniqueid: uniqueid,
        channel: evt.channel,
        callerid: evt.calleridnum || evt.callerid || 'Unknown',
        destination: dest || 'Unknown',
        context: evt.context,
        tenant_id: '28b0d0e2-0a39-48c0-84f9-d340472273a9',        
        state: evt.channelstate || 'Ringing',
        startTime: new Date().toISOString(),
        answered: false,
        duration: 0,
        agent: agentId
    };

    state.activeCalls.set(uniqueid, call);
    log('info', `New Call: ${call.callerid} -> ${call.destination}`);
    
    io.emit('call:new', call);
    broadcastActiveCalls();
}

function handleChannelState(evt) {
    const call = state.activeCalls.get(evt.uniqueid);
    if (!call) return;

    // Log the debug state for analysis
    console.log(`[DEBUG STATE] Channel: ${evt.channel} | State: ${evt.channelstate} (${evt.channelstatedesc})`);

    const rawState = evt.channelstate;
    const rawDesc = evt.channelstatedesc;

    if (rawState === '6' || rawState === 'Up' || rawDesc === 'Up') {
        if (!call.answered) {
            log('info', `Call Connected: ${call.callerid}`);
            call.answered = true;
            call.state = 'Answered';
            io.emit('call:answered', call); 
        }
    } else {
        call.state = rawDesc || rawState;
    }

    const extension = extractExtension(evt.channel);
    if (extension) updateAgentStatus(extension, call.answered ? 'talking' : 'ringing');

    io.emit('call:state', { uniqueid: evt.uniqueid, state: call.state });
    broadcastActiveCalls();
}

function handleCallAnswered(evt) {
    const call = state.activeCalls.get(evt.uniqueid);
    if (!call) return;

    call.answered = true;
    call.state = 'Answered'; 
    call.agent = extractExtension(evt.channel) || call.agent;
    
    if (call.agent) updateAgentStatus(call.agent, 'talking');

    io.emit('call:answered', call);
    broadcastActiveCalls();
}

function handleCallHangup(evt) {
    const call = state.activeCalls.get(evt.uniqueid);
    if (!call) return;

    const duration = Math.floor((new Date() - new Date(call.startTime)) / 1000);
    call.duration = duration;
    
    if (call.agent) updateAgentStatus(call.agent, 'available');

    state.activeCalls.delete(evt.uniqueid);
    io.emit('call:ended', call);
    broadcastActiveCalls();
}

function handleCallBridge(evt) {
    io.emit('call:bridged', evt);
    broadcastActiveCalls();
}

function handleAgentLogin(evt) { updateAgentStatus(evt.agent || evt.extension, 'available'); }
function handleAgentLogout(evt) { updateAgentStatus(evt.agent || evt.extension, 'offline'); }
function handleAgentCalled(evt) { updateAgentStatus(evt.agent || evt.extension, 'ringing'); }
function handlePeerStatus(evt) { 
    const ext = extractExtension(evt.peer);
    if(ext) updateAgentStatus(ext, evt.peerstatus === 'Reachable' ? 'available' : 'offline');
}
function handleExtensionStatus(evt) {
    if(evt.exten) updateAgentStatus(evt.exten, evt.status === '1' ? 'available' : 'offline');
}

function handleQueueMemberAdded(evt) { broadcastQueueStats(); }
function handleQueueMemberRemoved(evt) { broadcastQueueStats(); }
function handleQueueCallerJoined(evt) { broadcastQueueStats(); }
function handleQueueCallerAbandoned(evt) { broadcastQueueStats(); }

function updateAgentStatus(extension, status) {
    if (!extension) return;
    const agent = state.agents.get(extension) || { extension, callsToday: 0 };
    agent.status = status;
    state.agents.set(extension, agent);
    io.emit('agents:status', Array.from(state.agents.values()));
}

function updateQueueStats(evt) {}

function broadcastActiveCalls() {
    io.emit('calls:active', Array.from(state.activeCalls.values()));
}
function broadcastQueueStats() {
    io.emit('queues:stats', Array.from(state.queues.values()));
}

function extractExtension(channel) {
    if (!channel) return null;
    const match = channel.match(/PJSIP\/(\d+)/) || channel.match(/(\d{4,})/);
    return match ? match[1] : null;
}

function log(level, message) {
    console.log(`[${level.toUpperCase()}] ${message}`);
}

// ========== SOCKET.IO SUPERVISOR ACTIONS ==========

io.on('connection', (socket) => {
    log('info', `Dashboard connected: ${socket.id}`);

    socket.on('supervisor:monitor', (data) => handleSpyAction('monitor', data, socket));
    socket.on('supervisor:whisper', (data) => handleSpyAction('whisper', data, socket));
    socket.on('supervisor:barge', (data) => handleSpyAction('barge', data, socket));
});

function handleSpyAction(action, data, socket) {
    const { agentExtension } = data;
    let options = 'q'; 
    if (action === 'whisper') options = 'qw';
    if (action === 'barge') options = 'qB';

    ami.action({
        action: 'Originate',
        channel: `PJSIP/4001`, // Supervisor handset
        context: 'tenant_28b0d0e2_context',
        exten: `*55${agentExtension}`, // Assuming *55 ChanSpy prefix
        priority: 1,
        variable: `SPY_OPTIONS=${options}`
    }, (err, res) => {
        if (err) socket.emit('supervisor:error', { action, error: err.message });
        else socket.emit('supervisor:success', { action, agentExtension });
    });
}

httpServer.listen(config.socket.port, () => {
    log('info', `🚀 Watcher running on port ${config.socket.port}`);
    connectAMI();
});