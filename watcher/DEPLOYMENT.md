# AMI Watcher Deployment Guide

## Option 1: Run Watcher on Asterisk Server (Recommended)

Since AMI is typically only accessible on localhost for security, the best approach is to run the watcher service directly on the Asterisk server.

### Steps:

1. **SSH into your Asterisk server:**
   ```bash
   ssh user@bdl-pbx.itnetworld.co.nz
   ```

2. **Clone or copy the watcher directory to the server:**
   ```bash
   # On your Mac, create a tarball
   cd /Users/mba/Documents/mba_dev_projects/webphone
   tar -czf watcher.tar.gz watcher/
   
   # Transfer to server
   scp watcher.tar.gz user@bdl-pbx.itnetworld.co.nz:~/
   
   # On server, extract
   ssh user@bdl-pbx.itnetworld.co.nz
   tar -xzf watcher.tar.gz
   cd watcher
   ```

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Create `.env` file (use localhost for AMI):**
   ```env
   AMI_HOST=127.0.0.1
   AMI_PORT=5038
   AMI_USERNAME=node_watcher
   AMI_SECRET=AKLbdlpbxami2026
   
   SOCKET_PORT=3001
   CORS_ORIGIN=https://bdl-pbx.itnetworld.co.nz,http://localhost:8111
   
   LOG_LEVEL=info
   DEBUG=false
   ```

5. **Start with PM2 (recommended for production):**
   ```bash
   npm install -g pm2
   pm2 start watcher.js --name ami-watcher
   pm2 save
   pm2 startup  # To start on system boot
   ```

6. **Update frontend config** to point to the server:
   In `js/config.js`:
   ```javascript
   SOCKET_IO_URL: "https://bdl-pbx.itnetworld.co.nz:3001"
   ```

7. **Configure Nginx to proxy Socket.io:**
   Add to `/etc/nginx/sites-available/default`:
   ```nginx
   location /socket.io/ {
       proxy_pass http://127.0.0.1:3001;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
   }
   ```
   
   Then reload Nginx:
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

8. **Update frontend config** to use the proxied path:
   ```javascript
   SOCKET_IO_URL: "https://bdl-pbx.itnetworld.co.nz"  // Will use /socket.io/ path
   ```

---

## Option 2: SSH Tunneling (For Development)

If you want to run the watcher on your Mac during development:

1. **Create SSH tunnel:**
   ```bash
   ssh -L 5038:127.0.0.1:5038 user@bdl-pbx.itnetworld.co.nz
   ```

2. **Keep this terminal open** and run watcher in another terminal:
   ```bash
   cd /Users/mba/Documents/mba_dev_projects/webphone/watcher
   npm start
   ```

3. **Keep `AMI_HOST=127.0.0.1` in `.env`** - the tunnel will forward it

---

## Option 3: Enable Remote AMI Access (Less Secure)

⚠️ **Warning:** Only use this if you have proper firewall rules and authentication.

1. **SSH into Asterisk server:**
   ```bash
   ssh user@bdl-pbx.itnetworld.co.nz
   ```

2. **Edit `/etc/asterisk/manager.conf`:**
   ```ini
   [general]
   enabled = yes
   port = 5038
   bindaddr = 0.0.0.0  ; Listen on all interfaces
   ```

3. **Reload AMI:**
   ```bash
   asterisk -rx "manager reload"
   ```

4. **Open firewall port:**
   ```bash
   sudo ufw allow 5038/tcp
   # or
   sudo iptables -A INPUT -p tcp --dport 5038 -j ACCEPT
   ```

5. **Update watcher `.env`:**
   ```env
   AMI_HOST=bdl-pbx.itnetworld.co.nz
   ```

6. **Test connection:**
   ```bash
   telnet bdl-pbx.itnetworld.co.nz 5038
   ```

---

## Recommended: Option 1 (Run on Server)

This is the most secure and production-ready approach. The watcher service will:
- Connect to AMI on localhost (secure)
- Expose Socket.io on the server
- Be accessible via Nginx proxy
- Run as a service with PM2

