# AMI Connection Troubleshooting

## Error: `connect ECONNREFUSED 127.0.0.1:5038`

This means the watcher service cannot connect to Asterisk AMI. Here's how to fix it:

## Step 1: Check if Asterisk is Running

```bash
# Check if Asterisk process is running
ps aux | grep asterisk

# Or check with systemctl (if using systemd)
sudo systemctl status asterisk
```

## Step 2: Verify AMI is Enabled

SSH into your Asterisk server and check:

```bash
# Connect to Asterisk CLI
asterisk -rvvv

# Check AMI settings
manager show settings

# Check if AMI user exists
manager show users
```

You should see:
- `Enabled: Yes`
- `Port: 5038`
- Your `node_watcher` user listed

## Step 3: Test AMI Connection Manually

From your local machine (if Asterisk is remote) or from the server:

```bash
# Test connection with telnet
telnet 127.0.0.1 5038

# Or if Asterisk is on a remote server:
telnet YOUR_ASTERISK_IP 5038
```

If connection succeeds, you'll see Asterisk AMI prompt.

## Step 4: Check /etc/asterisk/manager.conf

Make sure your `/etc/asterisk/manager.conf` has:

```ini
[general]
enabled = yes
port = 5038
bindaddr = 127.0.0.1  ; or 0.0.0.0 if connecting from remote

[node_watcher]
secret = AKLbdlpbxami2026
read = system,call,agent,user,status
write = system,call,agent,originate
```

**Important:** If your watcher service is on a different machine than Asterisk:
- Change `bindaddr = 0.0.0.0` (to listen on all interfaces)
- Update `AMI_HOST` in `.env` to your Asterisk server IP
- Make sure port 5038 is open in firewall

## Step 5: Reload Asterisk Configuration

After making changes to `manager.conf`:

```bash
# In Asterisk CLI
asterisk -rx "manager reload"

# Or restart Asterisk
sudo systemctl restart asterisk
```

## Step 6: Check Firewall

If Asterisk is on a remote server:

```bash
# Check if port 5038 is open
sudo ufw status
# or
sudo iptables -L -n | grep 5038

# If needed, open the port
sudo ufw allow 5038/tcp
```

## Step 7: Update .env if Asterisk is Remote

If Asterisk is on a different machine, update `watcher/.env`:

```env
AMI_HOST=YOUR_ASTERISK_IP  # Instead of 127.0.0.1
AMI_PORT=5038
AMI_USERNAME=node_watcher
AMI_SECRET=AKLbdlpbxami2026
```

## Step 8: Test AMI Authentication

You can test AMI login manually:

```bash
# Connect to AMI
telnet 127.0.0.1 5038

# Then type:
Action: Login
Username: node_watcher
Secret: AKLbdlpbxami2026

# You should see:
Response: Success
Message: Authentication accepted
```

## Common Issues

### Issue: "bindaddr = 127.0.0.1" but connecting from remote
**Solution:** Change to `bindaddr = 0.0.0.0` and update firewall

### Issue: AMI user not found
**Solution:** Make sure `[node_watcher]` section exists in `manager.conf`

### Issue: Wrong secret/password
**Solution:** Double-check the secret in both `manager.conf` and `.env` match exactly

### Issue: Port 5038 already in use
**Solution:** Check what's using the port: `sudo lsof -i :5038`

## Quick Test Script

Create a test file `test-ami.js`:

```javascript
import AsteriskManager from 'asterisk-manager';

const ami = new AsteriskManager(5038, '127.0.0.1', 'node_watcher', 'AKLbdlpbxami2026', true);

ami.on('connect', () => {
    console.log('✅ AMI Connected!');
    process.exit(0);
});

ami.on('error', (err) => {
    console.error('❌ AMI Error:', err.message);
    process.exit(1);
});

setTimeout(() => {
    console.error('❌ Connection timeout');
    process.exit(1);
}, 5000);
```

Run: `node test-ami.js`

