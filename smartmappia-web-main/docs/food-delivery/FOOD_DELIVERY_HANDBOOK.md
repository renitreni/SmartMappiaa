# SmartMappia — Food Delivery Handbook (Devs & QA)

**Last updated: 2026-07-09.** A single, readable walkthrough of how the food-delivery
service actually flows end to end — who does what, which endpoints fire, where the data
lives — so a new developer or QA tester can picture the whole system without reading every
file. For the authoritative decision log see `FOOD_DELIVERY_STATUS.md`; for deep specs see
the `FOOD_DELIVERY_PRD/BACKEND/FRONTEND/ERD` docs in this folder.

This edition also documents the **latest change**: restaurant/menu images moved from pasted
URLs to real **file uploads** (new public `merchant-images` bucket), and admins can now
**create an owner account** for a restaurant at contract signing.

---

## 1. The cast (who uses it)

| Role | How they get in | What they do |
|---|---|---|
| **Customer** (passenger) | Self-signup, role `passenger` | Browse restaurants, build a cart, checkout, pay (STC Pay proof / cash), track the rider live, rate the driver. |
| **Driver** | Self-signup, role `driver`, then **admin-approved** after document verification | Receive Grab-style delivery offers, pick up (photo proof), deliver (photo proof), collect cash. |
| **Admin** | Email in `ADMIN_EMAILS` | Runs everything: restaurant CRUD, menu import, order accept/advance, payment verification, credit reconciliation, rider assignment, **owner-account provisioning**. |
| **Restaurant owner** (`merchant` role) | **Created by an admin** at contract signing — never self-service | Today: receives owner-targeted notifications and is the linked `owner_id`. Future: a merchant portal (not built yet). |

Key rule: the `merchant` role is **not** self-selectable. `backend/controllers/authController.js`
only lets a user pick `passenger` or `driver`; merchant is granted solely by the admin owner
endpoint (below).

---

## 2. Restaurant onboarding flow (admin-driven)

```
Restaurant contacts SmartMappia
        │
        ▼
[Admin] Food tab → "Add restaurant"      → POST /api/admin/food/merchants
        │  (starts UNLISTED, is_active=false; migration 0013)
        ▼
[Admin] Upload logo + import menu/items   → image signed-URL + PATCH endpoints
        │  (photos are real uploads now — see §4)
        ▼
[Admin] Contract signed → "Assign owner"  → POST /api/admin/food/merchants/:id/owner
        │  (creates account, role=merchant, sets owner_id)
        ▼
[Admin] Flip "Listed" (is_active=true)    → PATCH /api/admin/food/merchants/:id
        ▼
Restaurant now visible to customers
```

Everything above happens in the **admin Food tab** (`frontend/src/portal/admin/FoodAdmin.jsx`).

---

## 3. Customer order flow (end to end)

```
Browse            GET  /api/food/restaurants           (active + listed only)
Open menu         GET  /api/food/restaurants/:id       (categories + items)
Build cart        POST /api/food/cart/items ...        (server owns quantities)
Checkout          POST /api/food/orders                (server recomputes ALL money)
                    → 422 min_order (< 30 SAR) or outside_radius (> 15 km)
Pay (STC Pay)     POST /api/food/orders/:code/pay/signed-url  → upload proof → record
Pay (cash)        chosen at checkout; rider collects on delivery
Track live        GET  /api/food/orders/:code          (polled; rider pin glides)
Rate driver       POST /api/food/orders/:code/rate-driver     (1-5 stars, once)
```

Money is **never** trusted from the client — `backend/lib/foodMoney.js` recomputes subtotal,
the 10 SAR delivery fee, the 15 km radius check, and per-item margins from DB prices.

---

## 4. Restaurant & menu images — the NEW upload flow

**Before:** `merchants.logo_url` and `menu_items.image_url` were plain text fields; the admin
pasted a hosted `https://...` URL. There was no upload path, so attempting to *upload* an image
failed (500) — the only storage buckets were the **private** `payment-proofs` and `driver-docs`.

**Now:** images are uploaded to a new **public** bucket `merchant-images`, reusing the same
signed-upload pattern as proofs/driver-docs, but public so `<img src>` works directly.

### Flow (per image)

```
[Admin] picks a JPG/PNG/WebP in the Food tab (logo or menu item)
        │
        ▼
Frontend validates the file (type/size)          frontend/src/portal/lib/uploadFiles.js
        │
        ▼
POST /api/admin/food/merchants/:id/image/signed-url   body: { kind: 'logo'|'item', file_name, mime_type }
        │  → returns { bucket, path, token, publicUrl, maxBytes }
        ▼
Browser uploads straight to Supabase Storage     uploadProofFile(bucket, path, token, file)
        │  (file never passes through our server)
        ▼
Form field is set to publicUrl, then saved:
   logo  → PATCH /api/admin/food/merchants/:id      (logo_url = publicUrl)
   item  → POST/PATCH .../menu/items | /items/:id   (image_url = publicUrl)
```

### Key files (this change)

| Layer | File | What it does |
|---|---|---|
| Config | `backend/lib/config.js` | `merchantImages` block: bucket name, TTL, 5 MB cap, image-only MIME list, `kinds: ['logo','item']`. |
| Storage | `backend/lib/storage.js` | `buildMerchantImagePath`, `createMerchantImageUploadUrl`, `merchantImagePublicUrl` (getPublicUrl). |
| Validation | `backend/lib/uploadValidation.js` | `validateUploadFile({ imagesOnly: true })` — rejects PDFs for storefront images. |
| Endpoint | `backend/controllers/food/adminFoodController.js` → `createMerchantImageUploadUrl` | Validates, confirms merchant exists, returns signed URL + public URL. |
| Route | `backend/routes/admin.js` | `POST /food/merchants/:id/image/signed-url`. |
| API client | `frontend/src/portal/lib/api.js` | `adminFoodMerchantImageSignedUrl(id, body)`. |
| UI | `frontend/src/portal/admin/FoodAdmin.jsx` → `ImageUploadField` | File picker + preview + upload, used in both `RestaurantForm` (logo) and `ItemForm` (photo). |

### Notes / edge cases

- **New restaurant, no id yet:** you must **save the restaurant first**, then edit it to upload a
  logo (the upload path needs the merchant id). The field shows a hint until saved. Menu-item
  uploads always work because the menu editor opens on an existing restaurant.
- **Backward compatible:** rows that already hold an external image URL keep rendering — the DB
  columns are unchanged (still text); we just store an uploaded public URL in them now.
- **Allowed:** JPG, PNG, WebP up to 5 MB. PDFs are rejected for images (allowed only for proofs/docs).

---

## 5. Restaurant owner accounts — the NEW admin provisioning

**Why:** owner accounts should be created by an admin **after verification + contract signing**,
never open self-registration (avoids a flood of unvetted requests). The architecture was already
set up for this (migration 0013 made `owner_id` nullable, `merchant` role exists since 0009), but
the account-creation endpoint was missing — so `owner_id` was never set.

### Flow

```
[Admin] Food tab → restaurant row → "Assign owner"
        │  (button shows a green check if an owner is already linked)
        ▼
Enter owner email (+ optional name/phone)
        ▼
POST /api/admin/food/merchants/:id/owner   body: { email, full_name?, phone? }
        │  1. Create a confirmed auth user (or reuse an existing account by email)
        │  2. Upsert profile: role = 'merchant', name, phone
        │  3. Set merchants.owner_id
        │  4. audit_logs: 'admin_merchant_owner_linked'
        ▼
Owner is linked → owner-targeted notifications now reach a real account
```

### Key files (this change)

| Layer | File | What it does |
|---|---|---|
| Endpoint | `backend/controllers/food/adminFoodController.js` → `setMerchantOwner` | Create/reuse account, grant merchant role, link `owner_id`, audit. |
| Endpoint | same file → `listMerchants` | Now returns `ownerId` + `ownerEmail` so the UI shows linked status. |
| Route | `backend/routes/admin.js` | `POST /food/merchants/:id/owner`. |
| API client | `frontend/src/portal/lib/api.js` | `adminFoodSetMerchantOwner(id, body)`. |
| UI | `frontend/src/portal/admin/FoodAdmin.jsx` → `MerchantsSection` | "Assign owner" button + inline form; shows current owner email. |

### Scope / not built yet

- There is **no merchant-facing portal** — the owner account currently exists for linkage and
  notifications (and future login). Deciding what the owner logs into is a separate effort.
- Re-linking is blocked: if a restaurant already has an owner, the endpoint returns `409`. Change
  requires unlinking first (future enhancement).

---

## 6. Storage buckets (mental model)

| Bucket | Visibility | Holds | Served via |
|---|---|---|---|
| `payment-proofs` | **Private** | STC Pay proof images | short-lived signed download URLs (admin review) |
| `driver-docs` | **Private** | Driver verification documents | short-lived signed download URLs (admin review) |
| `merchant-images` | **Public** (NEW) | Restaurant logos + menu photos | plain public URL in `<img src>` |

All three use the **same upload mechanism**: the backend issues a short-lived signed upload URL/
token, the browser uploads directly to Supabase Storage, and the file never touches our server.
The only difference is that `merchant-images` is public (customer-facing), so we store and serve
a stable public URL instead of minting signed download URLs.

---

## 7. Setup checklist (before testing this)

1. **Create the bucket:** Supabase dashboard → Storage → new **public** bucket named
   `merchant-images`. (Private `payment-proofs` and `driver-docs` should already exist.)
2. **Env (optional):** defaults work; override in `backend/.env` with `MERCHANT_IMAGES_BUCKET`,
   `MERCHANT_IMAGES_MAX_BYTES` if needed (see `.env.example`).
3. **Frontend env:** `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` must be set (the browser
   uploads with the anon client). Without them the upload button shows a config hint.
4. Run backend (`npm run dev`) + frontend (`npm run dev`), sign in as an admin.

---

## 8. QA test plan (this change)

### Images
1. **Add restaurant → save → edit → upload logo.** On the *new* form the logo field shows the
   "save first" hint; after saving and reopening, the upload works. ✅ No 500.
2. **Upload verifies:** the file appears in the `merchant-images` bucket; `logo_url` now holds a
   `.../storage/v1/object/public/merchant-images/...` URL; the logo renders in the admin list and
   on the public restaurant page/homepage.
3. **Menu item photo:** open a restaurant's Menu → add/edit item → upload a photo → it renders in
   the item row and the customer menu.
4. **Replace + Remove:** replacing swaps the image; Remove clears it and the item shows the
   placeholder icon.
5. **Rejects bad files:** a PDF or a >5 MB image shows a friendly inline error and does **not**
   upload.
6. **Regression:** editing text-only fields (name, description, address, badge, lat/lng) still
   saves; a restaurant that had an external image URL still shows it.

### Owner accounts
7. **Assign owner (new):** on a restaurant with no owner, "Assign owner" → enter a fresh email →
   Create. Button flips to "Owner" with a green check; hovering shows the email.
8. **Verify server side:** an auth user exists for that email, its `profiles.role = 'merchant'`,
   `merchants.owner_id` is set, and `audit_logs` has `admin_merchant_owner_linked`.
9. **Reuse existing account:** assigning an owner whose email is already a customer links that same
   account and upgrades it to `merchant` (no duplicate).
10. **Already linked:** trying to assign an owner to a restaurant that already has one returns a
    clear `409` message.
11. **Owner notification:** suspend or replenish credit on an owned restaurant → the owner account
    receives the notification (previously a no-op when `owner_id` was null).

---

## 9. Where to look when something breaks

| Symptom | Likely cause / file |
|---|---|
| Image upload → 500 | `merchant-images` bucket missing, or not public. Create it in Supabase. |
| Image upload → "Supabase not configured" | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` unset in the frontend. |
| Uploaded image doesn't display | Bucket is **private** — must be public; check `merchantImagePublicUrl`. |
| "Only JPG and PNG images are accepted" | `imagesOnly` validation in `backend/lib/uploadValidation.js`. |
| Owner assign → 409 | Restaurant already has `owner_id`; unlink first. |
| Owner assign → role not applied | `profiles` upsert in `setMerchantOwner`; confirm `merchant` enum exists (migration 0009). |
| Money looks wrong | Never client-driven — `backend/lib/foodMoney.js`. |
