# WebRTC Call Center - Project Scope

**Last Updated:** 2026-02-12  
**Version:** 2.0.0  
**Status:** Active Development

---

## Project Overview

A modern, professional WebRTC-based call center application built for Asterisk PBX systems. The application provides a full-featured softphone interface for call center agents and supervisors, with role-based access control and advanced call management capabilities.

---

## Core Architecture

### Technology Stack
- **Frontend:** Vanilla JavaScript (ES6 Modules)
- **SIP/WebRTC:** SIP.js 0.21.2
- **Backend API:** PostgREST (RESTful API for PostgreSQL)
- **Database:** PostgreSQL with Row-Level Security (RLS)
- **PBX:** Asterisk 20.18.1
- **Proxy:** Nginx (WebSocket & API routing)

### Module Structure
```
js/
├── app.js          # Main application orchestrator
├── phone.js        # SIP/WebRTC phone engine
├── audio.js        # Audio device management
├── settings.js     # LocalStorage settings manager
├── config.js       # Configuration constants
├── history.js      # Call history/CDR integration
├── blf.js          # Busy Lamp Field (presence)
├── user.js         # User profile & role management
├── queue.js        # Queue login/logout management
├── recordings.js   # Call recordings access
└── supervisor.js   # Supervisor monitoring features
```

---

## Implemented Features

### ✅ Core Calling Features
- [x] **WebRTC SIP Registration** - Full SIP.js integration with WSS transport
- [x] **Outbound Calling** - Make calls to any number/extension
- [x] **Incoming Call Handling** - Accept/reject with visual popup
- [x] **Call Control:**
  - [x] Mute/Unmute
  - [x] Hold/Resume (SIP Re-Invite)
  - [x] Hangup
  - [x] DTMF Tone generation (RTP/RFC4733)
- [x] **Call Waiting** - Handle incoming calls while on another call
- [x] **Call Timer** - Real-time call duration display
- [x] **Audio Device Selection** - Microphone, speaker, and ringer routing
- [x] **Do Not Disturb (DND)** - Reject all incoming calls

### ✅ Advanced Call Features
- [x] **Blind Transfer** - Immediate transfer via SIP REFER
- [x] **Warm/Attended Transfer** - Consultation mode with line switching
- [x] **3-Way Conferencing** - Client-side audio mixing (Web Audio API)
- [x] **Line Management** - Switch between Line 1 (customer) and Line 2 (colleague)
- [x] **Dynamic Line Labels** - Display actual phone numbers on lines

### ✅ Presence & Monitoring
- [x] **Busy Lamp Field (BLF)** - Real-time colleague status monitoring
  - [x] Available (Green)
  - [x] Ringing (Orange/Blinking)
  - [x] Busy/Talking (Red)
  - [x] Offline (Gray)
- [x] **SIP Presence Subscription** - PIDF+XML parsing (RFC 3863)
- [x] **Colleague Management** - Configure monitored extensions

### ✅ Call History
- [x] **CDR Integration** - Fetch call records from PostgreSQL
- [x] **Call History Display** - Recent calls with direction indicators
- [x] **Redial Functionality:**
  - [x] Quick redial last number
  - [x] Redial from history list
- [x] **Recording Access** - Play recordings directly from history (when available)
- [x] **PostgREST Filtering** - Smart queries for inbound/outbound calls

### ✅ User Management
- [x] **Role-Based System:**
  - [x] Agent role (basic features)
  - [x] Supervisor role (advanced features)
  - [x] Admin role (full access)
- [x] **User Profile Management** - Extension, role, preferences storage
- [x] **Role Detection** - Automatic assignment based on extension number
- [x] **Permission System** - Feature access control based on role
- [x] **Role Badges** - Visual role indicators in UI

### ✅ Queue Management
- [x] **Queue Login/Logout** - Asterisk queue integration
- [x] **Queue Status Display** - Visual indicators for logged-in queues
- [x] **Queue Configuration UI** - Manage queue memberships
- [x] **Multiple Queue Support** - Login to multiple queues simultaneously

### ✅ UI/UX Features
- [x] **Modern Dark Theme** - Professional dark mode design
- [x] **Responsive Layout** - Grid-based sidebar + main stage
- [x] **Login Splash Screen** - Professional welcome overlay
- [x] **Auto-Login** - Remember credentials and auto-connect
- [x] **Settings Persistence** - All preferences saved to LocalStorage
- [x] **Modal System** - Config, BLF, History, Queue modals
- [x] **Loading States** - Spinner animations for async operations
- [x] **Visual Feedback** - Status indicators, active states, animations
- [x] **Role-Based UI** - Features show/hide based on permissions

### ✅ Technical Features
- [x] **SIP Keep-Alive** - NAT traversal with periodic pings
- [x] **Connection Stability** - Auto-reconnect on disconnect
- [x] **Error Handling** - Comprehensive error catching and user feedback
- [x] **Modular Architecture** - Clean separation of concerns
- [x] **Code Documentation** - JSDoc comments in all modules
- [x] **Backward Compatibility** - All existing features maintained

---

## Partially Implemented / Needs Backend

### 🔄 Supervisor Features (Frontend Ready)
- [x] **Supervisor Module** - Code structure complete
- [ ] **Monitor Active Calls** - Needs `/api/active_calls` endpoint
- [ ] **Whisper to Agent** - Needs Asterisk dialplan (`*2<extension>`)
- [ ] **Barge into Call** - Needs Asterisk dialplan (`*3<extension>`)
- [ ] **Agent Status Dashboard** - Needs `/api/agent_status` endpoint

### 🔄 Recordings (Frontend Ready)
- [x] **Recordings Module** - Code structure complete
- [ ] **List Recordings** - Needs `/api/recordings` endpoint
- [ ] **Play Recordings** - Needs recording file storage/URLs
- [ ] **Download Recordings** - Needs file serving endpoint

### 🔄 Queue Features (Frontend Ready)
- [x] **Queue Management UI** - Complete
- [ ] **Queue Status API** - Needs `/api/queues` endpoint
- [ ] **Queue Statistics** - Needs queue metrics endpoint
- [ ] **Queue Members API** - Needs queue member listing

---

## Planned Features

### 📋 High Priority
- [ ] **Call History Enhancements:**
  - [ ] Filter by date range
  - [ ] Search by number/name
  - [ ] Export to CSV/Excel
  - [ ] Pagination for large datasets
- [ ] **Supervisor Dashboard:**
  - [ ] Real-time active calls view
  - [ ] Agent performance metrics
  - [ ] Queue statistics (waiting, average handle time)
  - [ ] Wallboard integration
- [ ] **Recording Management:**
  - [ ] Recording search and filters
  - [ ] Bulk download
  - [ ] Recording annotations/notes
- [ ] **Enhanced Queue Features:**
  - [ ] Queue pause/resume
  - [ ] Queue statistics display
  - [ ] Queue member management (supervisor)

### 📋 Medium Priority
- [ ] **Advanced Call Features:**
  - [ ] Call parking
  - [ ] Call pickup (directed/group)
  - [ ] Call forwarding (unconditional/busy/no-answer)
  - [ ] Speed dial / favorites
- [ ] **User Experience:**
  - [ ] Keyboard shortcuts
  - [ ] Sound notifications customization
  - [ ] Theme customization (light/dark)
  - [ ] Multi-language support
- [ ] **Integration Features:**
  - [ ] CRM integration hooks
  - [ ] Webhook support for call events
  - [ ] Calendar integration
- [ ] **Mobile Responsiveness:**
  - [ ] Touch-optimized controls
  - [ ] Mobile-specific layouts
  - [ ] PWA support (offline capability)

### 📋 Low Priority / Future
- [ ] **Video Calling** - WebRTC video support
- [ ] **Screen Sharing** - Share screen during calls
- [ ] **Chat Integration** - In-app messaging
- [ ] **Voicemail** - Visual voicemail interface
- [ ] **Fax Support** - Send/receive faxes
- [ ] **Call Analytics** - Advanced reporting and analytics
- [ ] **Multi-Tenant UI** - Tenant switching interface
- [ ] **API Client SDK** - JavaScript SDK for custom integrations

---

## Backend API Requirements

### Required Endpoints

#### CDR/Call History
- ✅ `GET /api/cdr` - Already implemented (PostgREST)
  - Query params: `src`, `dst`, `start_time`, `order`, `limit`
  - Returns: Array of CDR records

#### Recordings
- ❌ `GET /api/recordings` - **Needs Implementation**
  - Query params: `uniqueid`, `src`, `dateFrom`, `dateTo`
  - Returns: Array of recording metadata
- ❌ `GET /api/recordings/{id}/stream` - **Needs Implementation**
  - Returns: Audio file stream (WAV/MP3)

#### Queues
- ❌ `GET /api/queues` - **Needs Implementation**
  - Returns: Array of available queues
- ❌ `GET /api/queue_status?queue={name}` - **Needs Implementation**
  - Returns: Queue statistics (waiting, agents, etc.)
- ❌ `GET /api/queue_members?queue={name}` - **Needs Implementation**
  - Returns: List of agents in queue

#### Active Calls
- ❌ `GET /api/active_calls` - **Needs Implementation**
  - Returns: Array of currently active calls
  - Fields: agent, caller, called, duration, uniqueid

#### Agent Status
- ❌ `GET /api/agent_status` - **Needs Implementation**
  - Returns: Array of agent statuses
  - Fields: extension, status, calls_today, avg_handle_time

#### Extensions/Users
- ❌ `GET /api/extensions?extension=eq.{ext}` - **Needs Implementation**
  - Returns: Extension details including role
  - Fields: extension, name, email, role, queues

---

## Asterisk Configuration Requirements

### Dialplan Extensions Needed

```ini
; Queue Management
exten => *60,1,Queue(login,${EXTEN:3})
exten => *61,1,Queue(logout,${EXTEN:3})

; Supervisor Features
exten => *1,1,ChanSpy(PJSIP/${EXTEN:2},q)      ; Monitor (listen only)
exten => *2,1,ChanSpy(PJSIP/${EXTEN:2},qw)     ; Whisper (talk to agent)
exten => *3,1,ChanSpy(PJSIP/${EXTEN:2},qB)     ; Barge (join conversation)

; Queue Login/Logout (alternative)
exten => *45,1,Queue(login)
exten => *46,1,Queue(logout)
```

### PJSIP Configuration
- WebRTC endpoints configured with `webrtc=yes`
- DTLS certificates configured
- WSS transport configured on port 8089

### Queue Configuration
- Queues defined in `queues.conf`
- Queue members assigned via dialplan or database

---

## Database Schema

### Current Tables (PostgreSQL)
- `cdr` - Call Detail Records
- `ps_endpoints` - PJSIP endpoints
- `ps_auths` - PJSIP authentication
- `ps_aors` - PJSIP Address of Records
- `ps_contacts` - PJSIP contacts
- `extensions` - Extension definitions
- `tenants` - Multi-tenant isolation
- `ps_registrations` - Registration status

### Tables Needed (Future)
- `recordings` - Recording metadata
  - Fields: id, uniqueid, file_path, duration, created_at
- `queues` - Queue definitions
  - Fields: id, name, strategy, timeout
- `queue_members` - Queue membership
  - Fields: queue_id, extension, penalty, paused
- `agent_status` - Real-time agent status
  - Fields: extension, status, current_call, login_time

---

## Configuration

### Environment Variables
```bash
# Database
DB_HOST=127.0.0.1
DB_NAME=asteriskdb
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_password

# Asterisk
ASTERISK_USER=asterisk
ASTERISK_PASS=secure_password

# API
API_USER=web_anon
```

### Frontend Configuration (`js/config.js`)
```javascript
DEFAULT_DOMAIN: "bdl-pbx.itnetworld.co.nz"
DEFAULT_WSS: "wss://bdl-pbx.itnetworld.co.nz:8089/ws"
CDR_API_URL: "https://bdl-pbx.itnetworld.co.nz/api/cdr"
```

### Role Configuration
- **Default:** Extensions 3000-3099 = Agent, 4000+ = Supervisor
- **Override:** `localStorage.setItem('cc_role_3001', 'supervisor')`
- **Future:** Fetch from `/api/extensions?extension=eq.3001`

---

## Testing Checklist

### Core Features
- [x] SIP registration and connection
- [x] Make outbound calls
- [x] Receive incoming calls
- [x] Hold/resume calls
- [x] Mute/unmute
- [x] Transfer (blind and warm)
- [x] 3-way conference
- [x] Call history display
- [x] BLF status monitoring
- [x] Queue login/logout

### Role-Based Features
- [ ] Agent role - basic features only
- [ ] Supervisor role - queue management visible
- [ ] Supervisor role - recordings access
- [ ] Supervisor role - monitoring features

### Browser Compatibility
- [ ] Chrome/Edge (Chromium)
- [ ] Firefox
- [ ] Safari
- [ ] Mobile browsers

---

## Known Issues / Limitations

1. **Queue Login/Logout:** Currently uses dialplan extensions (`*60`, `*61`). May need adjustment based on Asterisk configuration.

2. **Recordings:** Frontend ready but requires backend API and file storage setup.

3. **Supervisor Monitoring:** Dialplan extensions (`*1`, `*2`, `*3`) need to be configured in Asterisk.

4. **Role Detection:** Currently uses simple heuristics. Should be replaced with API lookup.

5. **Mobile Support:** Basic responsive design implemented, but touch interactions may need refinement.

---

## Development Roadmap

### Phase 1: Core Features ✅ (Completed)
- Basic calling functionality
- Call control (mute, hold, transfer)
- Call history
- BLF presence

### Phase 2: Advanced Features ✅ (Completed)
- Role-based system
- Queue management
- Recordings module
- Supervisor features (frontend)

### Phase 3: Backend Integration 🔄 (In Progress)
- Implement missing API endpoints
- Recording file storage
- Queue statistics API
- Agent status API

### Phase 4: Enhancements 📋 (Planned)
- Call history filtering/search
- Supervisor dashboard
- Advanced analytics
- Mobile optimization

### Phase 5: Enterprise Features 📋 (Future)
- Multi-tenant UI
- Advanced reporting
- CRM integrations
- Custom workflows

---

## Contributing

When adding new features:
1. Follow the modular architecture pattern
2. Add JSDoc comments to all functions
3. Update this SCOPE.md file
4. Update CHANGELOG.md
5. Test backward compatibility
6. Document API requirements if needed

---

## Support & Documentation

- **Changelog:** See `CHANGELOG.md` for version history
- **Configuration:** See `js/config.js` for settings
- **API Documentation:** See inline comments in modules
- **Asterisk Setup:** See backend documentation

---

**Last Review Date:** 2026-02-12  
**Next Review:** TBD

