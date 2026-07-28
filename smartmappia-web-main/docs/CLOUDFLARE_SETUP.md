# Cloudflare Setup Runbook (smartmappia.com)

Putting Cloudflare's **free tier** in front of the single Hostinger VPS before the
Aug 21 2026 launch. This is the one layer the current single-box deployment is
missing: `express-rate-limit` and helmet run *inside* Node, so they can't absorb
volumetric DDoS, Slowloris, or distributed credential-stuffing. Cloudflare handles
those at the edge, before traffic ever reaches the VPS.

**Architecture after this setup:**

```
Browser / APK  ──►  Cloudflare edge  ──►  Nginx (VPS :443)  ──►  Node/PM2 (127.0.0.1:4000)
                    DDoS / WAF / RL        real_ip + TLS          smartmappia-api
```

**What Cloudflare does NOT cover:** Supabase is a *separate origin* — the browser
talks to `*.supabase.co` directly, outside this Cloudflare zone. Supabase's own
platform protections cover that side. Cloudflare protects only the VPS/API.

---

## 0. Before you start — find your origin IP

Everything below needs the VPS public IP (shown as `<VPS_IP>`). Get it any of:

```
# On the box (root@srv1777854):
curl -s ifconfig.me
```
or Hostinger **hPanel → VPS → your server → Overview** (the IPv4 address),
or hPanel → **Domains → smartmappia.com → DNS** and read the current `A` record.

Keep this IP secret after setup — once the origin is locked to Cloudflare
(Step 4), only Cloudflare should ever reach it.

---

## 1. Add the site + switch nameservers to Cloudflare

The free plan proxy requires Cloudflare to be your **authoritative DNS**, which
means changing the nameservers at Hostinger.

1. Create a free account at <https://dash.cloudflare.com> → **Add a site** →
   `smartmappia.com` → choose the **Free** plan.
2. Cloudflare scans and imports your existing DNS records. **Review them** — make
   sure the web `A` record(s) and any mail (`MX`, `TXT`/SPF/DKIM) records came
   across. Mail records must stay **DNS-only** (grey cloud); see Step 2.
3. Cloudflare shows two nameservers, e.g. `xxx.ns.cloudflare.com` /
   `yyy.ns.cloudflare.com`. In Hostinger **hPanel → Domains → smartmappia.com →
   DNS / Nameservers → Change nameservers → Use custom nameservers**, paste both,
   save.
4. Propagation is usually 5–60 min. Cloudflare emails you when the zone is active.

> Registrar and hosting are both Hostinger but are independent: changing
> nameservers points DNS resolution at Cloudflare; the VPS itself is untouched.

---

## 2. DNS records in Cloudflare

In **Cloudflare → DNS → Records**:

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | `@` (smartmappia.com) | `<VPS_IP>` | **Proxied** (orange cloud) |
| A | `www` | `<VPS_IP>` | **Proxied** (orange cloud) |
| MX / TXT | (mail, if any) | (as-is) | **DNS only** (grey cloud) |

- **Orange cloud = protected.** Only proxied records get DDoS/WAF/caching and
  hide the origin IP. A grey-cloud record exposes `<VPS_IP>` publicly and defeats
  the origin lock-down — never proxy mail records, but always proxy web traffic.
- If you serve the APK backend on the same host, it rides the same proxied
  records (it calls `https://smartmappia.com/api/...`).

---

## 3. TLS / HTTPS

**Cloudflare → SSL/TLS:**

1. **Overview → Full (strict).** Not "Flexible" (that leaves origin traffic on
   HTTP and causes redirect loops) and not plain "Full" (accepts any origin cert).
   Full (strict) requires a valid cert on the origin — do one of:
   - **Keep your existing Let's Encrypt/certbot cert** on Nginx (works with Full
     strict as long as it's valid and not expired), **or**
   - **Use a Cloudflare Origin Certificate** (recommended, 15-year, only trusted
     by Cloudflare): SSL/TLS → **Origin Server → Create Certificate**, install the
     cert + key on the VPS and point Nginx at them:
     ```nginx
     ssl_certificate     /etc/ssl/cloudflare/smartmappia.pem;
     ssl_certificate_key /etc/ssl/cloudflare/smartmappia.key;
     ```
2. **Edge Certificates:** turn on **Always Use HTTPS**, **Automatic HTTPS
   Rewrites**, set **Minimum TLS Version 1.2**, and enable **HSTS** (Enable
   HSTS, max-age 6 months, include subdomains) — but only after you have confirmed
   HTTPS works end-to-end (HSTS is hard to undo in browsers).

---

## 4. Lock the origin to Cloudflare (the critical step)

Cloudflare is only real protection if attackers can't skip it by hitting
`<VPS_IP>` directly. Two things to close:

**(a) Only allow 80/443 from Cloudflare's IP ranges.** On the VPS with `ufw`:

```bash
# Reset to a known-good baseline (keep your SSH session in mind!)
ufw default deny incoming
ufw default allow outgoing

# SSH — restrict to your admin IP if you have a static one:
ufw allow from <YOUR_ADMIN_IP> to any port 22 proto tcp
# (or, less strict) ufw allow 22/tcp

# Allow HTTP/HTTPS ONLY from Cloudflare's published ranges:
for ip in $(curl -s https://www.cloudflare.com/ips-v4); do
  ufw allow from $ip to any port 80  proto tcp
  ufw allow from $ip to any port 443 proto tcp
done
for ip in $(curl -s https://www.cloudflare.com/ips-v6); do
  ufw allow from $ip to any port 80  proto tcp
  ufw allow from $ip to any port 443 proto tcp
done

ufw enable
ufw status verbose
```

> Hostinger also has a firewall in **hPanel → VPS → Firewall** — you can mirror
> the same rules there as a second layer. Cloudflare rotates its ranges rarely;
> re-run the loop after any Cloudflare IP-range announcement (or cron it monthly).

**(b) Don't expose the Node port.** `app.listen(PORT)` binds Node to `0.0.0.0`,
so `:4000` is reachable on the public interface unless blocked. Either:

- **No-code fix:** `ufw deny 4000` (Nginx reaches it over loopback, unaffected), or
- **Durable fix:** bind Node to loopback only — in `backend/server.js`:
  ```js
  app.listen(PORT, '127.0.0.1', () => { ... });
  ```
  Nginx already proxies to `127.0.0.1:4000`, so this changes nothing for real
  traffic but makes the port unreachable from outside the box.

---

## 5. Restore the real visitor IP in Nginx

With Cloudflare in front, every request arrives from a Cloudflare IP. Without this
step your rate limiters and logs would see Cloudflare, not the user. Configure
Nginx's real_ip module so `$remote_addr` becomes the true client, then pass a
single trustworthy `X-Forwarded-For` to Node.

Create `/etc/nginx/conf.d/cloudflare-realip.conf`:

```nginx
# Cloudflare IPv4 + IPv6 ranges — regenerate from https://www.cloudflare.com/ips/
# (script below). Trust the real client IP from Cloudflare's header.
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 131.0.72.0/22;
set_real_ip_from 2400:cb00::/32;
set_real_ip_from 2606:4700::/32;
set_real_ip_from 2803:f800::/32;
set_real_ip_from 2405:b500::/32;
set_real_ip_from 2405:8100::/32;
set_real_ip_from 2a06:98c0::/29;
set_real_ip_from 2c0f:f248::/32;
real_ip_header CF-Connecting-IP;
real_ip_recursive on;
```

Then, in the `location /api/` proxy block, **overwrite** (don't append) the
forwarded-for so Node receives exactly one Nginx-vouched client IP:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $remote_addr;   # overwrite, not $proxy_add_...
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

```bash
nginx -t && systemctl reload nginx
```

**Express `trust proxy`:** with the above, Node sits behind exactly **one** trusted
proxy (Nginx), so the current `app.set('trust proxy', 1)` in `backend/app.js`
stays **correct** — leave it at `1`. (This overwrite-XFF pattern is why you don't
bump it to 2; it also prevents a client from spoofing `X-Forwarded-For`.)

Verify real IPs are landing: `tail -f /var/log/nginx/access.log` should show
visitor IPs, not `104.x`/`172.x` Cloudflare addresses.

---

## 6. Edge rate limiting + bots (free plan)

These run at the edge, so abusive requests are dropped before touching the VPS —
complementing (not replacing) the in-app limiters.

**Security → WAF → Rate limiting rules** (free plan includes one custom rule;
spend it on the most sensitive path — login/signup):

- **Rule:** `(http.request.uri.path contains "/api/auth")`
  - When rate exceeds **10 requests per 1 minute** per client IP
  - Action: **Managed Challenge** (or Block for 10 min)

**Security → Bots → Bot Fight Mode: ON** (free) — challenges obvious bots/scrapers.

**Security → Settings → Security Level: Medium/High**, and enable
**Browser Integrity Check**.

> If you upgrade to **Pro ($20/mo)** later you get the full Managed WAF ruleset
> (OWASP core) and several rate-limit rules — worth it post-launch once you see
> real traffic. Free is sufficient for launch day.

---

## 7. Caching (keep API dynamic, cache the SPA)

**Rules → Cache Rules:**

1. **Never cache the API** — Rule: `(http.request.uri.path contains "/api/")` →
   **Bypass cache**. (Critical: payment/order/tracking responses must never be
   served stale from the edge.)
2. Static SPA assets (hashed `*.js` / `*.css` / images from Vite) are cached by
   default. Leave **Browser Cache TTL** at "Respect Existing Headers".
3. **Purge on deploy:** after each `npm run build` on the VPS, purge the edge so
   users get the new build — Cloudflare → **Caching → Configuration → Purge
   Everything** (or scope to `index.html`). Add this to your deploy runbook.

---

## 8. Turnstile on login (optional, post-launch)

Free CAPTCHA alternative to blunt credential-stuffing on `/api/auth`. Needs a
small code change (frontend widget + backend verify), so treat it as a fast
follow rather than launch-blocking:

1. Cloudflare → **Turnstile → Add widget** → get site key + secret key.
2. Render the widget on the login/signup form; send its token with the request.
3. Backend: before `signup`/login, POST the token to
   `https://challenges.cloudflare.com/turnstile/v0/siteverify` with the secret;
   reject on failure. (Mirror the `signupLimiter` placement.)

---

## 9. Verification checklist

- [ ] `smartmappia.com` resolves to a Cloudflare IP (`dig smartmappia.com` shows
      `104.x`/`172.x`, not `<VPS_IP>`).
- [ ] `https://smartmappia.com` loads over HTTPS; padlock valid; HTTP redirects to
      HTTPS.
- [ ] Direct origin access is blocked: `curl -sk https://<VPS_IP>/api/health`
      from outside the VPS **times out / is refused** (only Cloudflare can reach it).
- [ ] `curl https://<VPS_IP>:4000/api/health` from outside **fails** (Node port not
      public).
- [ ] Nginx access log shows real visitor IPs, not Cloudflare ranges.
- [ ] The web app works end-to-end: login, booking, tracking map, food order,
      payment-proof upload.
- [ ] **The APK still works** — see gotcha below.
- [ ] SSL mode is **Full (strict)**; Always Use HTTPS + HSTS on.
- [ ] `/api/*` bypasses cache; static assets cache; deploy purges the edge.

---

## 10. Gotchas

- **APK / CORS (see [android-apk-build] memory):** the Capacitor app is a
  cross-origin caller. Set `CORS_ORIGINS` in `backend/.env` to include the web
  origins **and** the app's origin (e.g. `https://smartmappia.com`,
  `https://www.smartmappia.com`, and the Capacitor scheme such as
  `https://localhost` / `capacitor://localhost`), then `pm2 restart
  smartmappia-api`. The backend now enforces the allow-list once it's set, so a
  missing app origin will break the APK with a CORS error.
- **522 / 523 errors** = Cloudflare can't reach the origin — almost always the
  firewall (Step 4) is blocking Cloudflare, the origin cert is invalid (Step 3),
  or Nginx is down. Re-check the `ufw` rules and `nginx -t`.
- **Redirect loop** = SSL mode is "Flexible". Switch to **Full (strict)**.
- **Rate-limit keys look wrong / everyone shares one bucket** = the real_ip config
  (Step 5) isn't applied; Node is keying on the Cloudflare IP.
- **Cloudflare IP ranges change** (rarely): re-run the Step 4 loop and refresh the
  Step 5 Nginx list, then reload Nginx.
- **Supabase is not behind Cloudflare** — don't expect the dashboard's WAF/analytics
  to show Supabase traffic; it never enters this zone.

---

Related: [../backend/app.js](../backend/app.js) (`trust proxy`, CORS allow-list),
`docs`/VPS deploy runbook, and the security review summary.
