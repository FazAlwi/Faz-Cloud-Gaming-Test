# FazCloud — Cloud Gaming Web Application

A minimalistic, full-stack cloud gaming portal built to orchestrate isolated **Selkies-GStreamer + Proton-GE** Docker containers on a Linux host with an **NVIDIA L4 GPU** (GCP `g2-standard-4` in `asia-southeast1`), complete with a `MOCK_DOCKER=true` mode for zero-dependency local testing on Windows, macOS, or Linux.

---

## Architecture

- **Frontend (`/client`):** React 19, Vite, TypeScript, Tailwind CSS v4, Lucide Icons.
- **Backend (`/server`):** Node.js (Express + ES Modules), `dockerode` (NVIDIA GPU passthrough, `/dev/dri`, per-user save mounts, read-only game library mount, explicit WebRTC UDP port ranges), `ioredis` (with automatic in-memory `Map` fallback if Redis isn't running).
- **Idle Reaper:** Background 60-second sweep automatically terminates containers with no heartbeat for >10 minutes to minimize GPU costs.

---

## 1. Local Development Mode (`MOCK_DOCKER=true`)

Run the entire UI flow (capacity tracking, 3-step boot choreography, simulated WebRTC stream iframe, heartbeat, fullscreen, and container teardown) without Docker, Redis, or an NVIDIA GPU.

### Configure Environment
```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```
By default, `server/.env.example` sets `MOCK_DOCKER=true`, `PORT=4000`, `PUBLIC_HOST=localhost`, `MAX_SLOTS=2`, and leaves `REDIS_URL` empty (using the automatic in-memory `Map` fallback).

### Install Dependencies
```bash
cd server && npm install
cd ../client && npm install
```

### Run Both Servers
In terminal 1 (backend):
```bash
cd server
npm run dev
```

In terminal 2 (frontend):
```bash
cd client
npm run dev
```

Open `http://localhost:5173`. Launch any game or click **Desktop / Steam Mode** to test the full boot modal and interactive simulated WebRTC stream viewport.

---

## 2. Production Deployment on GCP `g2-standard-4` (NVIDIA L4, `asia-southeast1`)

### Prerequisites on the VM
1. **Verify NVIDIA Driver & Container Toolkit:**
   ```bash
   nvidia-smi
   docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
   ls -la /dev/dri
   ```
2. **Prepare Persistent Storage Directories:**
   - `/srv/saves` — Writable per-user Steam & Proton volumes (mounted per container to `/config:rw`, preserving Steam login tokens, Proton prefixes, and game saves).
   - `/srv/games` — Optional shared read-only game library directory (mounted read-only to `/config/.local/share/Steam/steamapps/common:ro` so pre-installed games don't need to be re-downloaded per player; leave `GAMES_BASE_DIR=` empty to disable).
   ```bash
   sudo mkdir -p /srv/saves /srv/games
   sudo chown -R "$USER":"$USER" /srv/saves /srv/games
   ```
3. **Pull the LinuxServer Steam (Selkies + Proton) Image:**
   ```bash
   docker pull lscr.io/linuxserver/steam:latest
   ```
   *(Or replace `SELKIES_IMAGE` in `server/.env` with a custom tag/image.)*

### GCP VPC Firewall Rules
Allow WebRTC signaling/web ports and the dedicated per-container WebRTC UDP media port range so ICE candidates are never blocked:
- **TCP `80`, `443`**: HTTPS reverse proxy (Caddy/Nginx)
- **TCP `8081-8090`**: Dynamically allocated per-slot host ports mapped to container port `3001/tcp` (built-in HTTPS) or `3000/tcp` (HTTP behind an HTTPS proxy)
- **UDP `49152-49351`**: Dedicated WebRTC UDP media range (default: 20 UDP ports per slot across up to 10 slots, e.g., slot 0 uses `49152-49171`, slot 1 uses `49172-49191`)

```bash
gcloud compute firewall-rules create allow-cloud-gaming-webrtc \
  --direction=INGRESS \
  --priority=1000 \
  --network=default \
  --action=ALLOW \
  --rules=tcp:80,tcp:443,tcp:8081-8090,udp:49152-49351 \
  --target-tags=cloud-gaming-host
```

### HTTPS Requirement (WebCodecs, Pointer Lock & Gaming Mode)
> **Important:** In production, you **must** serve both the web portal and Selkies streams over **HTTPS**. Modern browsers require a secure `https://` context for **WebCodecs**, the **Pointer Lock API** (Gaming Mode relative mouse capture), and the **Gamepad API**.
> - Set `SELKIES_CONTAINER_PORT=3001` (default) to expose the container's built-in HTTPS endpoint directly on `8081–8090`.
> - Set `SELKIES_CONTAINER_PORT=3000` when terminating TLS in front of each slot with **Caddy** or **Nginx**.

Example `Caddyfile` using automatic TLS certificates (with `SELKIES_CONTAINER_PORT=3000`):
```caddyfile
play.yourdomain.com {
    # Serve built React app (/client/dist)
    root * /srv/faz-cloud-gaming/client/dist
    file_server

    # Proxy backend REST API
    handle /api/* {
        reverse_proxy localhost:4000
    }
}

# Optional per-slot HTTPS endpoints for Selkies streams (ports 8081-8082)
slot1.yourdomain.com {
    reverse_proxy localhost:8081
}

slot2.yourdomain.com {
    reverse_proxy localhost:8082
}
```

### Configure & Launch in Production (`MOCK_DOCKER=false`)
Edit `server/.env`:
```env
PORT=4000
PUBLIC_HOST=play.yourdomain.com
STREAM_PROTOCOL=https
CORS_ORIGIN=https://play.yourdomain.com
MAX_SLOTS=2
MOCK_DOCKER=false
SELKIES_IMAGE=lscr.io/linuxserver/steam:latest
SELKIES_CONTAINER_PORT=3001
SELKIES_ENCODER=nvh264enc
SAVES_BASE_DIR=/srv/saves
GAMES_BASE_DIR=/srv/games
WEBRTC_UDP_PORT_START=49152
WEBRTC_UDP_PORTS_PER_SLOT=20
# Optional: REDIS_URL=redis://127.0.0.1:6379
```

Build the frontend and start the backend:
```bash
cd client && npm install && npm run build
cd ../server && npm install --omit=dev && npm start
```

When `MOCK_DOCKER=false`, each container is launched with:
- Image `lscr.io/linuxserver/steam:latest` mapping container port `3001/tcp` (built-in HTTPS) or `3000/tcp` (behind HTTPS proxy) to the dynamically allocated host port (`8081–8090`)
- `--gpus all` (`DeviceRequests` NVIDIA driver) + `/dev/dri` device access
- `NVIDIA_DRIVER_CAPABILITIES=all`, `NVIDIA_VISIBLE_DEVICES=all`, `AUTO_GPU=nvidia`, `SELKIES_VIDEO_STREAMING_MODE=true`, and hardware NVENC (`SELKIES_ENCODER=nvh264enc` / `h264enc`)
- `SecurityOpt: ["seccomp=unconfined", "apparmor=unconfined"]` so Steam's bubblewrap sandbox runs natively on Ubuntu 24.04 without falling back to slow `proot-bwrap`
- Per-user `/srv/saves/${safeUserId}:/config:rw` and optional shared `/srv/games:/config/.local/share/Steam/steamapps/common:ro`
- Auto-launch `/custom-cont-init.d/99-faz-autolaunch.sh` running `steam -bigpicture steam://rungameid/${steamAppId}` when launching a game (falling back to standard Steam/Desktop mode when `gameId === "desktop"`)
- Explicit per-slot WebRTC UDP port bindings (`SELKIES_WEBRTC_PORT_RANGE`) and 2 GB `/dev/shm`

---

## REST API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Host status, active container count, max slots, GPU & store backend |
| `GET` | `/api/games` | Seeded PC game catalog + Desktop/Steam mode metadata |
| `GET` | `/api/sessions/:userId` | Returns active session for `userId` (or `null`) |
| `POST` | `/api/sessions/start` | Starts or reuses session (`{ userId, gameId }`); returns `503` when full |
| `POST` | `/api/sessions/stop` | Stops/removes container (`{ userId }`) and frees the port slot |
| `POST` | `/api/sessions/heartbeat` | Refreshes session TTL (`{ userId }`) to prevent 10-minute idle reap |
