# AMI Watcher Service

Real-time Asterisk Manager Interface (AMI) monitoring service for the WebRTC Call Center supervisor dashboard.

## Purpose

This Node.js service connects to Asterisk AMI to provide real-time call center data via Socket.io, enabling:
- Live supervisor dashboard
- Real-time wallboard updates
- Active call monitoring
- Agent status tracking
- Queue statistics
- Supervisor call intrusion (monitor, whisper, barge)

## Features

- ✅ Real-time active calls tracking
- ✅ Agent status monitoring (available, talking, ringing, offline)
- ✅ Queue statistics (waiting calls, members, available agents)
- ✅ Supervisor actions (monitor, whisper, barge)
- ✅ Automatic reconnection on AMI disconnect
- ✅ Event filtering and state management
- ✅ Socket.io WebSocket communication

## Installation

```bash
cd watcher
npm install
```

## Configuration

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Edit `.env` with your settings:
```env
AMI_HOST=127.0.0.1
AMI_PORT=5038
AMI_USERNAME=node_watcher
AMI_SECRET=AKLbdlpbxami2026

SOCKET_PORT=3001
CORS_ORIGIN=http://localhost:8080,https://bdl-pbx.itnetworld.co.nz
```

## Running

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

Or with PM2:
```bash
pm2 start watcher.js --name ami-watcher
```

## Asterisk Configuration

Ensure your `/etc/asterisk/manager.conf` has:

```ini
[general]
enabled = yes
port = 5038
bindaddr = 127.0.0.1

[node_watcher]
secret = AKLbdlpbxami2026
read = system,call,agent,user,status
write = system,call,agent,originate
```

## Socket.io Events

### Client → Server

#### Supervisor Actions
```javascript
// Monitor (listen only)
socket.emit('supervisor:monitor', {
    agentExtension: '3001',
    callUniqueId: '1770784970.56'
});

// Whisper (talk to agent)
socket.emit('supervisor:whisper', {
    agentExtension: '3001'
});

// Barge (join conversation)
socket.emit('supervisor:barge', {
    agentExtension: '3001'
});
```

### Server → Client

#### Connection Status
```javascript
socket.on('ami:connected', (data) => {
    console.log('AMI connected', data);
});

socket.on('ami:disconnected', (data) => {
    console.log('AMI disconnected', data);
});

socket.on('ami:error', (data) => {
    console.error('AMI error', data);
});
```

#### Active Calls
```javascript
// Single call event
socket.on('call:new', (call) => {
    console.log('New call:', call);
});

socket.on('call:answered', (call) => {
    console.log('Call answered:', call);
});

socket.on('call:ended', (call) => {
    console.log('Call ended:', call);
});

// All active calls (sent on connection and updates)
socket.on('calls:active', (calls) => {
    console.log('Active calls:', calls);
});
```

#### Agent Status
```javascript
socket.on('agent:login', (data) => {
    console.log('Agent logged in:', data);
});

socket.on('agent:logout', (data) => {
    console.log('Agent logged out:', data);
});

// All agent statuses
socket.on('agents:status', (agents) => {
    console.log('Agent statuses:', agents);
});
```

#### Queue Statistics
```javascript
socket.on('queue:caller_joined', (data) => {
    console.log('Caller joined queue:', data);
});

socket.on('queues:stats', (queues) => {
    console.log('Queue statistics:', queues);
});
```

## Data Structures

### Active Call Object
```javascript
{
    uniqueid: "1770784970.56",
    channel: "PJSIP/3001-00000024",
    callerid: "+6421436772",
    destination: "092430770",
    context: "from-external",
    state: "Up",
    startTime: "2026-02-12T06:30:31.000Z",
    answerTime: "2026-02-12T06:30:33.000Z",
    answered: true,
    duration: 5,
    agent: "3001",
    disposition: "ANSWERED"
}
```

### Agent Status Object
```javascript
{
    extension: "3001",
    status: "talking",  // available, talking, ringing, offline
    callsToday: 15,
    currentCall: "1770784970.56",
    loginTime: "2026-02-12T06:00:00.000Z",
    lastUpdate: "2026-02-12T06:30:33.000Z",
    queue: "sales"
}
```

### Queue Statistics Object
```javascript
{
    name: "sales",
    waiting: 3,
    members: 5,
    available: 2,
    longestWait: 45
}
```

## Supervisor Actions (Asterisk Dialplan)

For supervisor actions to work, you need dialplan contexts:

```ini
[spy-monitor]
exten => _X.,1,ChanSpy(PJSIP/${EXTEN},q)
exten => _X.,n,Hangup()

[spy-whisper]
exten => _X.,1,ChanSpy(PJSIP/${EXTEN},qw)
exten => _X.,n,Hangup()

[spy-barge]
exten => _X.,1,ChanSpy(PJSIP/${EXTEN},qB)
exten => _X.,n,Hangup()
```

## Troubleshooting

### AMI Connection Failed
- Check `manager.conf` is enabled
- Verify username and secret match
- Ensure AMI port (5038) is accessible
- Check firewall rules

### No Events Received
- Verify AMI user has `read` permissions
- Check Asterisk logs: `asterisk -rvvv`
- Ensure events are enabled in AMI connection

### Socket.io Connection Issues
- Check CORS origin matches your frontend URL
- Verify Socket.io port (3001) is accessible
- Check firewall/Nginx configuration

## Logging

Set log level in `.env`:
- `debug` - All events
- `info` - Important events (default)
- `warn` - Warnings only
- `error` - Errors only

Enable debug mode:
```env
DEBUG=true
```

## Security Notes

- AMI should only bind to `127.0.0.1` (localhost)
- Use strong secrets for AMI authentication
- Restrict CORS origins to your domain
- Consider using HTTPS/WSS in production
- Use firewall rules to restrict access

## Integration with Frontend

See `js/supervisor.js` for frontend integration example.

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:3001');

socket.on('calls:active', (calls) => {
    // Update supervisor dashboard
    updateActiveCalls(calls);
});
```

## License

MIT

