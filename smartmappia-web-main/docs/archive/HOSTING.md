# Hosting Plan — SmartMappia (Riyadh)

## Final Stack Decision

| Layer | Service | Cost |
|---|---|---|
| Frontend (React build) | Hostinger Static Hosting | ~$3/mo |
| Backend (Express + OSRM) | Hostinger KVM 2 VPS | ~$10/mo |
| Database / Auth / Realtime | Supabase Pro | $25/mo |
| SSL | Let's Encrypt via Certbot | Free |
| **Total** | | **~$38/mo** |

---

## Architecture

```
Users
 ├── Hostinger Static Hosting  →  React frontend (dist/)
 └── Hostinger KVM 2 VPS
      ├── Nginx (reverse proxy + SSL)
      ├── Express.js (PM2, port 4000)  →  Supabase Pro (DB + Auth + Realtime)
      └── OSRM (port 5000, Riyadh map data)
```

---

## VPS Resource Breakdown (KVM 2 — 8GB RAM)

```
OS + Nginx          ~500 MB
Express (PM2)       ~300 MB
OSRM (Riyadh)      ~2.5 GB
Free headroom       ~4.5 GB
```

KVM 2 handles Express + OSRM comfortably for Riyadh.

---

## Capacity Estimates

| Metric | Estimate |
|---|---|
| Concurrent active users | ~2,000–4,000 |
| Simultaneous active drivers | ~800–1,500 |
| Total registered users (DB) | Unlimited |
| API requests/second | ~1,000–2,000 |

---

## Supabase Pro Limits

| Resource | Included |
|---|---|
| Database size | 8 GB |
| File storage | 100 GB |
| Bandwidth | 250 GB/month |
| Extra DB storage | ~$0.125/GB |
| Extra file storage | ~$0.021/GB |

---

## SSL

- **Hostinger Static** — 1-click enable in dashboard (free)
- **Hostinger VPS** — Let's Encrypt via Certbot (free, auto-renews)
- **Supabase Pro** — HTTPS by default (free)

Certbot setup on VPS:
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

---

## OSRM Setup on VPS (Riyadh)

- Map source: Saudi Arabia extract from Geofabrik (~350 MB .pbf file)
- OSRM processed RAM usage: ~1.5–2.5 GB
- Processing time: ~10–15 min (one-time)
- Runs as a service on port 5000
- Express calls `localhost:5000` for routing

---

## Scaling Path

Scale when you see: VPS CPU consistently above 70%, RAM above 80%, or response times slowing under load.

### Stage 1 — Launch (Now)
| Service | Spec | Users |
|---|---|---|
| Hostinger Static | Basic | Unlimited (static) |
| Hostinger KVM 2 | 8GB / 2 cores | ~2,000–4,000 concurrent |
| Supabase Pro | 8GB DB / 100GB storage | Millions of records |

### Stage 2 — Growing
| Service | Spec | Users |
|---|---|---|
| Hostinger Static | Same | Unlimited |
| Hostinger KVM 4 | 16GB / 4 cores | ~5,000–10,000 concurrent |
| OSRM | More headroom, full Saudi Arabia map | Expanded coverage |
| Supabase Pro | Same, pay for extra storage if needed | Scales automatically |

### Stage 3 — Large Scale
| Service | Spec | Users |
|---|---|---|
| Hostinger Static | Same | Unlimited |
| Hostinger KVM 8 | 32GB / 8 cores | ~15,000–25,000 concurrent |
| Supabase Pro | Same | Scales automatically |

### Stage 4 — Enterprise (if needed)
Move off Hostinger VPS to a cloud provider with auto-scaling:
- **AWS / GCP / Azure** — load balancer + multiple Express instances
- **Supabase stays** — no reason to migrate the DB at this point
- Only needed if you're running city-wide operations across multiple regions

### When to Scale Supabase
| Trigger | Action |
|---|---|
| DB approaching 8 GB | Pay for extra storage ($0.125/GB) — no plan change needed |
| Need more compute | Contact Supabase for Enterprise plan |
| Storage approaching 100 GB | Pay for extra ($0.021/GB) |

Supabase scales with usage automatically — no manual upgrade needed until very large scale.

---

## Deployment Checklist

- [ ] Buy domain on Hostinger
- [ ] Set up Hostinger Static Hosting — upload `dist/` after `npm run build`
- [ ] Set up Hostinger KVM 2 VPS
- [ ] Install Nginx, Node.js, PM2, Certbot on VPS
- [ ] Configure Nginx reverse proxy (`/api` → port 4000)
- [ ] Set up SSL via Certbot
- [ ] Upload backend, create `.env` with Supabase keys
- [ ] Start backend with PM2
- [ ] Download Saudi Arabia OSM data, process with OSRM
- [ ] Run OSRM as a service on port 5000
- [ ] Migrate Supabase to a standalone account (off Vercel Marketplace) and upgrade it to Pro — see [production/SUPABASE_MIGRATION.md](production/SUPABASE_MIGRATION.md)
- [ ] Point frontend `.env` API URL to VPS domain
