# Quick Setup Guide for AMI Watcher

## Step 1: Navigate to the watcher directory

```bash
cd /Users/mba/Documents/mba_dev_projects/webphone/watcher
```

## Step 2: Install dependencies

```bash
npm install
```

This will install:
- asterisk-manager
- socket.io
- dotenv
- cors

## Step 3: Create .env file (if not exists)

Create a `.env` file in the watcher directory with:

```env
# Asterisk Manager Interface (AMI) Configuration
AMI_HOST=127.0.0.1
AMI_PORT=5038
AMI_USERNAME=node_watcher
AMI_SECRET=AKLbdlpbxami2026

# Socket.io Server Configuration
SOCKET_PORT=3001
CORS_ORIGIN=http://localhost:8111,http://localhost:8080,https://bdl-pbx.itnetworld.co.nz

# Logging
LOG_LEVEL=info
DEBUG=false
```

## Step 4: Start the service

```bash
npm start
```

You should see:
```
[timestamp] [INFO] 🚀 Socket.io server listening on port 3001
[timestamp] [INFO] 📡 CORS enabled for: http://localhost:8111,http://localhost:8080,https://bdl-pbx.itnetworld.co.nz
[timestamp] [INFO] ✅ Connected to Asterisk AMI
```

## Troubleshooting

### If npm install fails with permissions:
Try using `sudo` (not recommended) or fix npm permissions:
```bash
sudo chown -R $(whoami) ~/.npm
```

### If connection to AMI fails:
1. Check `/etc/asterisk/manager.conf` is configured correctly
2. Verify AMI is enabled: `asterisk -rx "manager show settings"`
3. Test AMI connection: `telnet localhost 5038`

### If Socket.io connection fails from browser:
1. Check the watcher service is running
2. Verify CORS_ORIGIN in .env includes your frontend URL
3. Check browser console for connection errors
4. Verify port 3001 is not blocked by firewall

## Running in Background

### Using PM2 (recommended for production):
```bash
npm install -g pm2
pm2 start watcher.js --name ami-watcher
pm2 save
pm2 startup  # To start on system boot
```

### Using nohup:
```bash
nohup npm start > watcher.log 2>&1 &
```

## Development Mode (with auto-reload):
```bash
npm run dev
```

