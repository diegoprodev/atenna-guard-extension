# VPS Access & Deployment Guide

**Last Updated:** 2026-05-08  
**Backend Status:** ✅ Running (Docker)

---

## Quick Access via SSH

### Prerequisites
- SSH Key: `/c/Users/dgapc/.ssh/atenna-vps` (private key)
- VPS IP: `157.90.246.156`
- Port: 22 (default)
- User: `root`

### Connect
```bash
ssh -i /c/Users/dgapc/.ssh/atenna-vps root@157.90.246.156
```

### Alias (Optional - Add to ~/.ssh/config)
```
Host atenna-vps
  HostName 157.90.246.156
  User root
  IdentityFile /c/Users/dgapc/.ssh/atenna-vps
  Port 22
```
Then use: `ssh atenna-vps`

---

## Backend Location & Configuration

**Backend Path:** `/root/atenna-backend/`

**Environment File:** `/root/atenna-backend/.env`

**Key Variables:**
```
GEMINI_API_KEY=AIzaSyCds3pmir9nOVsAxcSt6w695PUd-hhHJg8
OPENAI_API_KEY=sk-proj-...
SUPABASE_URL=https://kezbssjmgwtrunqeoyir.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

---

## Docker Management

**View Status:**
```bash
docker ps --format 'table {{.Names}}\t{{.Status}}'
```

**View Logs:**
```bash
docker logs --tail 50 -f atenna-backend-backend-1
```

**Restart Backend:**
```bash
cd /root/atenna-backend
docker compose down
docker compose up -d
```

**Health Check:**
```bash
curl http://localhost:8000/health
```

---

## Multi-LLM Configuration (Added 2026-05-08)

### LLM Stack
- **Primary:** Gemini API (gemini-2.5-flash-lite)
- **Fallback 1:** OpenAI gpt-4o-mini (when Gemini fails)
- **Fallback 2:** Template-based prompts (when both fail)

### Verify Keys Loaded
```bash
docker exec atenna-backend-backend-1 python3 -c "import os; print('[OPENAI]:', 'FOUND' if os.getenv('OPENAI_API_KEY') else 'MISSING'); print('[GEMINI]:', 'FOUND' if os.getenv('GEMINI_API_KEY') else 'MISSING')"
```

### Expected Output
```
[OPENAI]: FOUND
[GEMINI]: FOUND
```

---

## Deployment Workflow

### If Code Changes Needed:
1. **Local:** Commit changes to main branch
2. **Local:** Build: `npm run build`
3. **Local:** Test: `npm test`
4. **VPS:** Pull changes (if repo available)
5. **VPS:** Rebuild Docker: `docker compose build --no-cache`
6. **VPS:** Restart: `docker compose up -d`
7. **VPS:** Verify health: `curl http://localhost:8000/health`

### Current Status:
- ✅ Backend deployed in Docker
- ✅ No git repo on VPS (artifacts-based deployment)
- ✅ Manual rebuild required if backend code changes
- ⚠️ Environment variables must be added to `/root/atenna-backend/.env` directly

---

## Monitoring & Troubleshooting

**Backend Port:** `127.0.0.1:8000` (exposed via nginx on 80/443)

**Nginx Config:** `/root/atenna-backend/nginx/default.conf`

**Data Directory:** `/root/atenna-backend/data/`

**Health Status Script:**
```bash
ssh -i /c/Users/dgapc/.ssh/atenna-vps root@157.90.246.156 \
  "curl -s http://localhost:8000/health && echo && \
   docker ps --format 'table {{.Names}}\t{{.Status}}'"
```

---

## Security Notes
- 🔒 API keys stored only in VPS `/root/atenna-backend/.env`
- 🔒 Never commit `.env` to git
- 🔒 SSH key `/c/Users/dgapc/.ssh/atenna-vps` is private (not versioned)
- 🔒 Backup `.env` regularly
- 🔒 Rotate API keys periodically (especially OpenAI)

---

## Contact & Changes
- Last configured: 2026-05-08
- Next review: When backend code changes
- Maintainer: Diego Rodrigues

