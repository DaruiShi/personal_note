# Deploying Personal Notes on Aliyun (Alibaba Cloud)

Two things make Aliyun different from a generic VPS:

1. **Security Group** — the firewall lives in the Aliyun console, not just on
   the machine. Ports you open in `ufw` stay closed until the security group
   allows them too.
2. **ICP 备案** — if the ECS is in a **mainland China region** (Beijing,
   Hangzhou, Shanghai, Shenzhen, …) and you serve a website on a **domain
   name**, that domain must have an ICP filing, or traffic on 80/443 gets
   intercepted. IP-address access on a custom port is generally not affected.

Pick your route first:

| Route | Needs | HTTPS | ICP filing? |
| ----- | ----- | ----- | ----------- |
| A. Domain + Caddy (recommended) | a domain | auto (Let's Encrypt) | Yes, for mainland regions |
| B. Bare IP `http://IP:3000` | nothing | no | No |

Tip: an ECS in **Hong Kong / Singapore / other international region** needs
**no ICP** — that is the fastest way to Route A. A 轻量应用服务器 (Simple
Application Server, ~¥30+/month) is enough for personal use; its firewall
settings are in its own console.

---

## 1. Create the instance and open ports

1. Buy an ECS (or Simple Application Server): **Ubuntu 22.04/24.04**,
   2 vCPU / 2 GiB is plenty for this app.
2. Console → ECS → **Security Group (安全组)** → your group →
   **Add inbound rule (添加入方向规则)**:
   - `22`   TCP  — SSH (source: your IP if possible)
   - `80`   TCP  — HTTP (needed by Let's Encrypt + redirect)
   - `443`  TCP  — HTTPS
   - `3000` TCP  — only if you take Route B

## 2. Install Node.js (on the server)

```bash
ssh root@YOUR_SERVER_IP

# Option 1: NodeSource (fast outside mainland)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Option 2 (mainland, if NodeSource is slow): Ubuntu's own nodejs is v18,
# which meets the >= 18 requirement and the app needs zero npm packages.
sudo apt-get update && sudo apt-get install -y nodejs

node -v   # must be v18+
```

## 3. Upload the app

On the server:

```bash
sudo useradd --system --home /opt/notes --shell /usr/sbin/nologin notes
sudo mkdir -p /opt/notes/data
sudo chown -R notes:notes /opt/notes
```

From your Windows machine (Git Bash / PowerShell — the project folder is
`D:\Develop\personal_note`):

```bash
scp -r server.js public deploy package.json README.md root@YOUR_SERVER_IP:/opt/notes/
```

(WinSCP with drag & drop works too.) Then on the server:

```bash
sudo chown -R notes:notes /opt/notes
```

## 4. Run it as a service

```bash
sudo cp /opt/notes/deploy/notes.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now notes

# sanity check — should print JSON with needsSetup / registrationOpen
curl http://127.0.0.1:3000/api/session
```

## 5a. Route A — domain + HTTPS with Caddy

1. **DNS**: Aliyun console → 云解析 DNS → your domain → add an
   **A record** pointing to the server IP.
2. **Mainland region only: complete the ICP filing first**
   (阿里云 ICP 代备案系统, free, ~1–3 weeks). Skip this for
   Hong Kong/international regions.
3. Install Caddy and point it at the app:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

sudo nano /etc/caddy/Caddyfile
```

Replace the contents (use **your** domain):

```
notes.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl reload caddy
```

Caddy obtains and renews the Let's Encrypt certificate automatically —
this is why ports 80 and 443 must be open.

4. **Tell the app it is behind a proxy** (so login rate limiting sees real
   client IPs):

```bash
sudo systemctl edit notes
```

```ini
[Service]
Environment=TRUST_PROXY=1
Environment=PUBLIC_BASE_URL=https://notes.example.com
```

Set `PUBLIC_BASE_URL` to the same domain Caddy serves — it is the origin
baked into share-page `og:url`/`canonical` tags and QR codes.

```bash
sudo systemctl restart notes
```

Open `https://notes.example.com` — done.

## 5b. Route B — bare IP, no domain

```bash
sudo systemctl edit notes
```

```ini
[Service]
Environment=HOST=0.0.0.0
Environment=PORT=3000
```

```bash
sudo systemctl restart notes
```

Open `http://YOUR_SERVER_IP:3000` from anywhere. Security group must allow
port 3000 (step 1).

> Caution: this is plain HTTP — your password crosses the internet
> unencrypted whenever you sign in on an untrusted network. Prefer Route A
> for anything long-term, or restrict access to a VPN/WireGuard tunnel.

## 6. First-run checklist

- Open the site → create the admin account (first registration = admin).
- Register your other accounts, then **Account → Manage users → turn off
  "Allow new registrations"** so strangers can't sign up.
- Set up a backup cron (all data is one file):

```bash
sudo crontab -e
# daily 03:00 backup (notes.json + uploaded images):
0 3 * * * cp -a /opt/notes/data /root/notes-backup-$(date +\%F)
```

## Updating the deployed app

The app is stateless code plus one data file, so updating is just: upload
the new files, restart the service. Accounts, notes, and sessions live only
in `/opt/notes/data/notes.json`, which the update never touches.

From your development machine (Git Bash in the project folder):

```bash
tar czf notes.tgz server.js public package.json deploy
scp notes.tgz root@YOUR_SERVER_IP:/tmp/
ssh root@YOUR_SERVER_IP "sudo tar xzf /tmp/notes.tgz -C /opt/notes && sudo /opt/notes/deploy/update.sh && rm /tmp/notes.tgz"
```

`deploy/update.sh` (ships with the app) backs up the data file, fixes
ownership, restarts the service, and health-checks it.

Manual equivalent on the server:

```bash
sudo cp /opt/notes/data/notes.json /root/notes-backup-$(date +%F-%H%M%S).json
sudo chown -R notes:notes /opt/notes
sudo systemctl restart notes
curl -fsS http://127.0.0.1:3000/api/session
```

Notes:

- Assets are served with `Cache-Control: no-store`, so every browser picks
  up the new CSS/JS on its next page load — no cache clearing needed.
- Nobody gets logged out: sessions are persisted in the data file and the
  service restart takes about a second.
- If anything looks wrong: `journalctl -u notes -f`, and restore a data
  backup by copying it back over `/opt/notes/data/notes.json` and
  restarting.

## Troubleshooting

- **Site unreachable** → check the security group first (most common cause),
  then `systemctl status notes caddy`, then `ss -tlnp | grep -E '3000|443'`.
- **Certificate fails to issue** → DNS not propagated yet, or ports 80/443
  not open, or (mainland) ICP filing missing.
- **Mainland + domain without ICP** → an Aliyun interception page appears;
  complete the filing or move to a Hong Kong region.
- Logs: `journalctl -u notes -f` and `journalctl -u caddy -f`.
