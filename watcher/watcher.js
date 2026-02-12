/**
 * Asterisk Manager Interface (AMI) Watcher Service
 * 
 * Created: 2026-02-12
 * Last Modified: 2026-02-12
 * 
 * Purpose:
 * Connects to Asterisk AMI to monitor call center activity in real-time.
 * Broadcasts events via Socket.io to web clients for supervisor dashboard,
 * wallboard, and live call monitoring.
 * 
 * Features:
 * - Real-time active calls tracking
 * - Agent status monitoring
 * - Queue statistics
 * - Supervisor actions (monitor, whisper, barge)
 * - Event filtering and aggregation
 * 
 * Use Cases:
 * - Supervisor dashboard with live call data
 * - Wallboard display
 * - Real-time agent monitoring
 * - Call intrusion capabilities
 */

import { Server } from 'socket.io';
import AsteriskManager from 'asterisk-manager';
import dotenv from 'dotenv';
import http from 'http';
import cors from 'cors';

// Load environment variables
dotenv.config();

// Configuration
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
            origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:8080'],
            methods: ['GET', 'POST'],
            credentials: true
        }
    },
    logLevel: process.env.LOG_LEVEL || 'info',
    debug: process.env.DEBUG === 'true'
};

// State Management
const state = {
    activeCalls: new Map(),      // uniqueid -> call object
    agents: new Map(),            // extension -> agent status
    queues: new Map(),            // queue_name -> queue stats
    connected: false,
    lastEvent: null
};

// Create HTTP server for Socket.io
const httpServer = http.createServer();
const io = new Server(httpServer, {
    cors: config.socket.cors,
    transports: ['websocket', 'polling']
});

// Initialize AMI Connection
let ami = null;

/**
 * Connect to Asterisk AMI
 */
function connectAMI() {
    try {
        ami = new AsteriskManager(
            config.ami.port,
            config.ami.host,
            config.ami.username,
            config.ami.secret,
            true  // events enabled
        );

        // Connection successful
        ami.on('connect', () => {
            state.connected = true;
            log('info', '✅ Connected to Asterisk AMI');
            
            // Emit connection status to all clients
            io.emit('ami:connected', { timestamp: new Date().toISOString() });
            
            // Request initial state
            requestInitialState();
        });

        // Connection error
        ami.on('error', (error) => {
            state.connected = false;
            log('error', `❌ AMI Error: ${error.message}`);
            io.emit('ami:error', { message: error.message, timestamp: new Date().toISOString() });
        });

        // Disconnection
        ami.on('disconnect', () => {
            state.connected = false;
            log('warn', '⚠️  Disconnected from AMI');
            io.emit('ami:disconnected', { timestamp: new Date().toISOString() });
        });

        // ========== CALL EVENTS ==========
        
        // New channel created (call started)
        ami.on('newchannel', (evt) => {
            handleNewChannel(evt);
        });

        // Channel state changed
        ami.on('newstate', (evt) => {
            handleChannelState(evt);
        });

        // Call answered
        ami.on('answer', (evt) => {
            handleCallAnswered(evt);
        });

        // Call ended
        ami.on('hangup', (evt) => {
            handleCallHangup(evt);
        });

        // Call transferred
        ami.on('bridge', (evt) => {
            handleCallBridge(evt);
        });

        // ========== AGENT EVENTS ==========
        
        // Agent login
        ami.on('agentlogin', (evt) => {
            handleAgentLogin(evt);
        });

        // Agent logout
        ami.on('agentlogout', (evt) => {
            handleAgentLogout(evt);
        });

        // Agent called
        ami.on('agentcalled', (evt) => {
            handleAgentCalled(evt);
        });

        // ========== QUEUE EVENTS ==========
        
        // Queue member added
        ami.on('queue member added', (evt) => {
            handleQueueMemberAdded(evt);
        });

        // Queue member removed
        ami.on('queue member removed', (evt) => {
            handleQueueMemberRemoved(evt);
        });

        // Queue caller joined
        ami.on('queue caller joined', (evt) => {
            handleQueueCallerJoined(evt);
        });

        // Queue caller abandoned
        ami.on('queue caller abandoned', (evt) => {
            handleQueueCallerAbandoned(evt);
        });

        // ========== SYSTEM EVENTS ==========
        
        // Peer status (endpoint registration)
        ami.on('peerstatus', (evt) => {
            handlePeerStatus(evt);
        });

        // Extension status
        ami.on('extensionstatus', (evt) => {
            handleExtensionStatus(evt);
        });

        // Keep connection alive
        setInterval(() => {
            if (state.connected) {
                ami.action({ action: 'Ping' }, (err, res) => {
                    if (err) log('error', `Ping failed: ${err.message}`);
                });
            }
        }, 30000);

    } catch (error) {
        log('error', `Failed to initialize AMI: ${error.message}`);
        setTimeout(connectAMI, config.ami.reconnect_after);
    }
}

/**
 * Request initial state from Asterisk
 */
function requestInitialState() {
    // Get active channels
    ami.action({
        action: 'CoreShowChannels'
    }, (err, res) => {
        if (!err && res.events) {
            res.events.forEach(evt => {
                if (evt.event === 'CoreShowChannel') {
                    handleNewChannel(evt);
                }
            });
        }
    });

    // Get queue status
    ami.action({
        action: 'QueueStatus'
    }, (err, res) => {
        if (!err && res.events) {
            res.events.forEach(evt => {
                if (evt.event === 'QueueParams') {
                    updateQueueStats(evt);
                }
            });
        }
    });
}

// ========== EVENT HANDLERS ==========

function handleNewChannel(evt) {
    const uniqueid = evt.uniqueid || evt.uniqueid1;
    if (!uniqueid) return;

    const call = {
        uniqueid: uniqueid,
        channel: evt.channel,
        callerid: evt.calleridnum || evt.callerid,
        destination: evt.exten || evt.destination,
        context: evt.context,
        state: evt.channelstate || 'Unknown',
        startTime: new Date().toISOString(),
        answered: false,
        duration: 0,
        agent: extractExtension(evt.channel)
    };

    state.activeCalls.set(uniqueid, call);
    
    log('debug', `New channel: ${call.channel} (${call.callerid} → ${call.destination})`);
    
    // Broadcast to clients
    io.emit('call:new', call);
    broadcastActiveCalls();
}

function handleChannelState(evt) {
    const uniqueid = evt.uniqueid;
    const call = state.activeCalls.get(uniqueid);
    if (!call) return;

    call.state = evt.channelstate || call.state;
    
    // Update agent status if this is an agent channel
    const extension = extractExtension(evt.channel);
    if (extension) {
        updateAgentStatus(extension, 'talking');
    }

    io.emit('call:state', { uniqueid, state: call.state });
}

function handleCallAnswered(evt) {
    const uniqueid = evt.uniqueid;
    const call = state.activeCalls.get(uniqueid);
    if (!call) return;

    call.answered = true;
    call.answerTime = new Date().toISOString();
    call.agent = extractExtension(evt.channel) || call.agent;

    log('info', `Call answered: ${call.callerid} by ${call.agent}`);

    // Update agent status
    if (call.agent) {
        updateAgentStatus(call.agent, 'talking');
    }

    io.emit('call:answered', call);
    broadcastActiveCalls();
}

function handleCallHangup(evt) {
    const uniqueid = evt.uniqueid;
    const call = state.activeCalls.get(uniqueid);
    if (!call) return;

    // Calculate duration
    const start = new Date(call.startTime);
    const end = new Date();
    call.duration = Math.floor((end - start) / 1000);
    call.endTime = end.toISOString();
    call.disposition = evt.cause || 'Normal';

    log('info', `Call ended: ${call.callerid} (${call.duration}s)`);

    // Update agent status
    if (call.agent) {
        updateAgentStatus(call.agent, 'available');
    }

    // Remove from active calls
    state.activeCalls.delete(uniqueid);

    // Broadcast
    io.emit('call:ended', call);
    broadcastActiveCalls();
}

function handleCallBridge(evt) {
    // Call transferred or bridged
    log('debug', `Call bridged: ${evt.channel1} <-> ${evt.channel2}`);
    io.emit('call:bridged', evt);
    broadcastActiveCalls();
}

function handleAgentLogin(evt) {
    const extension = evt.agent || evt.extension;
    if (!extension) return;

    updateAgentStatus(extension, 'available', {
        queue: evt.queue,
        loginTime: new Date().toISOString()
    });

    log('info', `Agent logged in: ${extension}`);
    io.emit('agent:login', { extension, queue: evt.queue });
    broadcastAgentStatus();
}

function handleAgentLogout(evt) {
    const extension = evt.agent || evt.extension;
    if (!extension) return;

    updateAgentStatus(extension, 'offline');
    
    log('info', `Agent logged out: ${extension}`);
    io.emit('agent:logout', { extension });
    broadcastAgentStatus();
}

function handleAgentCalled(evt) {
    const extension = evt.agent || evt.extension;
    if (!extension) return;

    updateAgentStatus(extension, 'ringing');
    
    io.emit('agent:called', { extension, queue: evt.queue });
    broadcastAgentStatus();
}

function handleQueueMemberAdded(evt) {
    const queue = evt.queue;
    updateQueueMemberCount(queue, 1);
    io.emit('queue:member_added', evt);
    broadcastQueueStats();
}

function handleQueueMemberRemoved(evt) {
    const queue = evt.queue;
    updateQueueMemberCount(queue, -1);
    io.emit('queue:member_removed', evt);
    broadcastQueueStats();
}

function handleQueueCallerJoined(evt) {
    const queue = evt.queue;
    updateQueueWaitingCount(queue, 1);
    io.emit('queue:caller_joined', evt);
    broadcastQueueStats();
}

function handleQueueCallerAbandoned(evt) {
    const queue = evt.queue;
    updateQueueWaitingCount(queue, -1);
    io.emit('queue:caller_abandoned', evt);
    broadcastQueueStats();
}

function handlePeerStatus(evt) {
    const extension = extractExtension(evt.peer);
    if (!extension) return;

    const status = evt.peerstatus === 'Reachable' ? 'available' : 'offline';
    updateAgentStatus(extension, status);
    broadcastAgentStatus();
}

function handleExtensionStatus(evt) {
    const extension = evt.exten;
    if (!extension) return;

    // Update based on extension status
    const status = evt.status === '1' ? 'available' : 'offline';
    updateAgentStatus(extension, status);
    broadcastAgentStatus();
}

// ========== STATE MANAGEMENT ==========

function updateAgentStatus(extension, status, metadata = {}) {
    const agent = state.agents.get(extension) || {
        extension,
        status: 'offline',
        callsToday: 0,
        currentCall: null,
        loginTime: null
    };

    agent.status = status;
    agent.lastUpdate = new Date().toISOString();
    Object.assign(agent, metadata);

    state.agents.set(extension, agent);
}

function updateQueueStats(queueName, data) {
    const queue = state.queues.get(queueName) || {
        name: queueName,
        waiting: 0,
        members: 0,
        available: 0,
        longestWait: 0
    };

    if (data.waiting !== undefined) queue.waiting = data.waiting;
    if (data.members !== undefined) queue.members = data.members;
    if (data.available !== undefined) queue.available = data.available;

    state.queues.set(queueName, queue);
}

function updateQueueMemberCount(queueName, delta) {
    const queue = state.queues.get(queueName) || {
        name: queueName,
        waiting: 0,
        members: 0,
        available: 0
    };
    queue.members = Math.max(0, queue.members + delta);
    state.queues.set(queueName, queue);
}

function updateQueueWaitingCount(queueName, delta) {
    const queue = state.queues.get(queueName) || {
        name: queueName,
        waiting: 0,
        members: 0,
        available: 0
    };
    queue.waiting = Math.max(0, queue.waiting + delta);
    state.queues.set(queueName, queue);
}

// ========== BROADCAST FUNCTIONS ==========

function broadcastActiveCalls() {
    const calls = Array.from(state.activeCalls.values());
    io.emit('calls:active', calls);
}

function broadcastAgentStatus() {
    const agents = Array.from(state.agents.values());
    io.emit('agents:status', agents);
}

function broadcastQueueStats() {
    const queues = Array.from(state.queues.values());
    io.emit('queues:stats', queues);
}

// ========== SOCKET.IO HANDLERS ==========

io.on('connection', (socket) => {
    log('info', `Client connected: ${socket.id}`);

    // Send initial state
    socket.emit('ami:connected', { connected: state.connected });
    socket.emit('calls:active', Array.from(state.activeCalls.values()));
    socket.emit('agents:status', Array.from(state.agents.values()));
    socket.emit('queues:stats', Array.from(state.queues.values()));

    // Supervisor Actions
    socket.on('supervisor:monitor', async (data) => {
        await handleSupervisorAction('monitor', data, socket);
    });

    socket.on('supervisor:whisper', async (data) => {
        await handleSupervisorAction('whisper', data, socket);
    });

    socket.on('supervisor:barge', async (data) => {
        await handleSupervisorAction('barge', data, socket);
    });

    socket.on('disconnect', () => {
        log('info', `Client disconnected: ${socket.id}`);
    });
});

/**
 * Handle supervisor actions (monitor, whisper, barge)
 */
async function handleSupervisorAction(action, data, socket) {
    if (!state.connected) {
        socket.emit('error', { message: 'AMI not connected' });
        return;
    }

    const { agentExtension, callUniqueId } = data;
    
    try {
        let amiAction;
        
        switch (action) {
            case 'monitor':
                // ChanSpy with 'q' flag (quiet, listen only)
                amiAction = {
                    action: 'Originate',
                    channel: `Local/${agentExtension}@spy-monitor`,
                    context: 'default',
                    priority: 1,
                    variable: `SPY_OPTIONS=q`
                };
                break;
                
            case 'whisper':
                // ChanSpy with 'qw' flag (quiet + whisper)
                amiAction = {
                    action: 'Originate',
                    channel: `Local/${agentExtension}@spy-whisper`,
                    context: 'default',
                    priority: 1,
                    variable: `SPY_OPTIONS=qw`
                };
                break;
                
            case 'barge':
                // ChanSpy with 'qB' flag (quiet + barge)
                amiAction = {
                    action: 'Originate',
                    channel: `Local/${agentExtension}@spy-barge`,
                    context: 'default',
                    priority: 1,
                    variable: `SPY_OPTIONS=qB`
                };
                break;
        }

        ami.action(amiAction, (err, res) => {
            if (err) {
                log('error', `${action} failed: ${err.message}`);
                socket.emit('supervisor:error', { action, error: err.message });
            } else {
                log('info', `Supervisor ${action} initiated for ${agentExtension}`);
                socket.emit('supervisor:success', { action, agentExtension });
            }
        });
        
    } catch (error) {
        log('error', `Supervisor action error: ${error.message}`);
        socket.emit('supervisor:error', { action, error: error.message });
    }
}

// ========== UTILITY FUNCTIONS ==========

function extractExtension(channel) {
    if (!channel) return null;
    // Extract extension from channel name (e.g., "PJSIP/3001-00000024" -> "3001")
    const match = channel.match(/PJSIP\/(\d+)/) || channel.match(/(\d{4,})/);
    return match ? match[1] : null;
}

function log(level, message) {
    const timestamp = new Date().toISOString();
    const levels = ['debug', 'info', 'warn', 'error'];
    const levelIndex = levels.indexOf(level);
    const minLevel = levels.indexOf(config.logLevel);
    
    if (levelIndex >= minLevel || config.debug) {
        console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
    }
}

// ========== STARTUP ==========

// Start HTTP server
httpServer.listen(config.socket.port, () => {
    log('info', `🚀 Socket.io server listening on port ${config.socket.port}`);
    log('info', `📡 CORS enabled for: ${config.socket.cors.origin.join(', ')}`);
    
    // Connect to AMI
    connectAMI();
});

// Graceful shutdown
process.on('SIGTERM', () => {
    log('info', 'Shutting down gracefully...');
    if (ami) ami.disconnect();
    httpServer.close(() => {
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    log('info', 'Shutting down gracefully...');
    if (ami) ami.disconnect();
    httpServer.close(() => {
        process.exit(0);
    });
});

