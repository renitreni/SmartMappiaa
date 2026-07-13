// ---------------------------------------------------------------------
// Backend client. Auth is automatic: if a Supabase session exists, every
// request carries `Authorization: Bearer <access_token>`, so the backend
// knows who the caller is and what role they have.
// ---------------------------------------------------------------------
import { supabase } from './supabaseClient';
import { notifyError } from './notify';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';

async function authHeader() {
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Pass { silent: true } for background/polling calls so a transient failure
// doesn't fire a popup every few seconds. All other errors show one via Swal.
async function request(path, { method = 'GET', body, headers = {}, silent = false } = {}) {
  const auth = await authHeader();

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...auth, ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Network/CORS failure: the server couldn't be reached at all.
    const err = new Error('Network error: could not reach the server. Please check your connection.');
    err.status = 0;
    if (!silent) notifyError(err.message);
    throw err;
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty / non-JSON body */
  }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.details = data && data.details;
    if (!silent) notifyError(msg);
    throw err;
  }
  return data;
}

export const api = {
  base: API_BASE,

  // --- auth ---
  authSignup: (body) => request('/api/auth/signup', { method: 'POST', body }),
  authSync: (body = {}) => request('/api/auth/sync', { method: 'POST', body, silent: true }),

  // --- passenger ---
  createBooking: (b) => request('/api/bookings', { method: 'POST', body: b }),
  myBookings: () => request('/api/bookings', { silent: true }), // Pick & Drop history
  getBooking: (code) => request(`/api/bookings/${code}`),
  cancelBooking: (code, reason) => request(`/api/bookings/${code}/cancel`, { method: 'POST', body: { reason } }),
  paymentInstructions: (code) => request(`/api/bookings/${code}/payment-instructions`),
  proofSignedUrl: (code, body) => request(`/api/bookings/${code}/payment-proof/signed-url`, { method: 'POST', body }),
  recordProof: (code, body) => request(`/api/bookings/${code}/payment-proof`, { method: 'POST', body }),
  // Tap Payments hosted-redirect charge (backend endpoint pending — see NOTES §2).
  createTapCharge: (code) => request(`/api/payments/${code}/tap-charge`, { method: 'POST' }),
  tracking: (code) => request(`/api/tracking/${code}`, { silent: true }), // polled every 8s

  // --- location search / nearby places ---
  locationSearch: (q, coords = {}) => {
    const params = new URLSearchParams({ q });
    if (coords.lat != null && coords.lng != null) {
      params.set('lat', coords.lat);
      params.set('lng', coords.lng);
    }
    return request(`/api/locations/search?${params}`, { silent: true });
  },
  locationReverse: (lat, lng) => request(`/api/locations/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`, { silent: true }),
  locationNearby: (lat, lng, radius = 1200) =>
    request(`/api/locations/nearby?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&radius=${encodeURIComponent(radius)}`, { silent: true }),

  // --- admin (role enforced by backend) ---
  adminStats: () => request('/api/admin/stats'),
  adminReports: (range) => request(`/api/admin/reports?range=${encodeURIComponent(range)}`),
  adminList: (query = '') => request(`/api/admin/bookings${query}`),
  adminDetail: (code) => request(`/api/admin/bookings/${code}`),
  adminVerify: (code, body = {}) => request(`/api/admin/bookings/${code}/verify-payment`, { method: 'POST', body }),
  adminReject: (code, reason) => request(`/api/admin/bookings/${code}/reject-payment`, { method: 'POST', body: { reason } }),
  adminAssign: (code, driver_id) => request(`/api/admin/bookings/${code}/assign-driver`, { method: 'POST', body: { driver_id } }),
  adminDrivers: () => request('/api/admin/drivers'),
  adminApproveDriver: (driverId, approved = true) =>
    request(`/api/admin/drivers/${driverId}/approval`, { method: 'POST', body: { approved } }),
  adminDriverDocuments: (driverId) => request(`/api/admin/drivers/${driverId}/documents`),
  adminReviewDoc: (driverId, docId, body) =>
    request(`/api/admin/drivers/${driverId}/documents/${docId}/review`, { method: 'POST', body }),

  // --- driver (identity from token) ---
  driverAvailable: (lat, lng) => {
    const q = lat != null && lng != null ? `?lat=${lat}&lng=${lng}` : '';
    return request(`/api/driver/available${q}`, { silent: true }); // polled feed
  },
  driverRides: () => request('/api/driver/rides', { silent: true }), // polled feed
  driverAccept: (code) => request(`/api/driver/rides/${code}/accept`, { method: 'POST' }),
  driverStatus: (code, status) => request(`/api/driver/rides/${code}/status`, { method: 'POST', body: { status } }),
  driverLocation: (body) => request('/api/driver/location', { method: 'POST', body, silent: true }), // 12s GPS ping
  // driver verification documents
  driverDocSignedUrl: (body) => request('/api/driver/documents/signed-url', { method: 'POST', body }),
  driverRecordDoc: (body) => request('/api/driver/documents', { method: 'POST', body }),
  driverDocuments: () => request('/api/driver/documents', { silent: true }),

  // --- notifications ---
  // The signed-in user's own notification history (last 50), powering the bell.
  listNotifications: () => request('/api/notifications', { silent: true }),
  notificationPushConfig: () => request('/api/notifications/push-config', { silent: true }),
  registerPushToken: (body) => request('/api/notifications/register', { method: 'POST', body, silent: true }),
  unregisterPushToken: (token) => request('/api/notifications/unregister', { method: 'POST', body: { token }, silent: true }),
  markNotificationsRead: () => request('/api/notifications/read', { method: 'PATCH', silent: true }),

  // --- food delivery: customer ---
  foodRestaurants: (params = '') => request(`/api/food/restaurants${params}`, { silent: true }),
  foodRestaurant: (id) => request(`/api/food/restaurants/${id}`, { silent: true }),
  foodCart: (merchantId) => request(`/api/food/cart?merchant_id=${encodeURIComponent(merchantId)}`, { silent: true }),
  foodCartAdd: (body) => request('/api/food/cart/items', { method: 'POST', body }),
  foodCartUpdate: (id, quantity) => request(`/api/food/cart/items/${id}`, { method: 'PATCH', body: { quantity } }),
  foodCartRemove: (id) => request(`/api/food/cart/items/${id}`, { method: 'DELETE' }),
  // Checkout: the backend recomputes all money and enforces the 30 SAR
  // minimum + 15 km radius; a 422 carries failure_reason for the UI.
  foodCheckout: (body, idempotencyKey) =>
    request('/api/food/orders', { method: 'POST', body, headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}, silent: true }),
  foodOrders: () => request('/api/food/orders'),
  foodOrder: (code) => request(`/api/food/orders/${code}`, { silent: true }), // polled on tracking
  foodPaymentInfo: (code) => request(`/api/food/orders/${code}/pay`),
  foodPaySignedUrl: (code, body) => request(`/api/food/orders/${code}/pay/signed-url`, { method: 'POST', body }),
  foodRecordPayment: (code, body) => request(`/api/food/orders/${code}/pay`, { method: 'POST', body }),
  foodTapCharge: (code) => request(`/api/food/orders/${code}/tap-charge`, { method: 'POST' }),
  foodEvent: (body) => request('/api/food/events', { method: 'POST', body, silent: true }),

  // --- food delivery: driver dispatch (Grab-style offers + deliveries) ---
  driverOffers: () => request('/api/driver/offers', { silent: true }), // polled while online
  driverOfferAccept: (id) => request(`/api/driver/offers/${id}/accept`, { method: 'POST', silent: true }),
  driverOfferDecline: (id) => request(`/api/driver/offers/${id}/decline`, { method: 'POST', silent: true }),
  driverDeliveries: () => request('/api/driver/deliveries', { silent: true }),
  driverOpenDeliveries: (lat, lng) => {
    const q = lat != null && lng != null ? `?lat=${lat}&lng=${lng}` : '';
    return request(`/api/driver/deliveries/available${q}`, { silent: true }); // polled feed
  },
  driverClaimDelivery: (code) => request(`/api/driver/deliveries/${code}/claim`, { method: 'POST' }),
  // Photo proof is mandatory: upload first, then send the path with the status.
  driverDeliveryPhotoUrl: (code, body) => request(`/api/driver/deliveries/${code}/photo-url`, { method: 'POST', body }),
  driverDeliveryStatus: (code, status, photo_path) =>
    request(`/api/driver/deliveries/${code}/status`, { method: 'POST', body: { status, photo_path } }),

  // --- business owner / merchant ---
  merchantProfile: () => request('/api/merchant/profile'),
  merchantUpdateProfile: (body) => request('/api/merchant/profile', { method: 'PATCH', body }),
  merchantLogoSignedUrl: (body) => request('/api/merchant/logo/signed-url', { method: 'POST', body }),
  merchantLogoConfirm: (body) => request('/api/merchant/logo/confirm', { method: 'POST', body }),
  merchantMenuItemImageSignedUrl: (body) =>
    request('/api/merchant/menu/items/image/signed-url', { method: 'POST', body }),
  merchantMenuItemImageConfirm: (body) =>
    request('/api/merchant/menu/items/image/confirm', { method: 'POST', body }),
  merchantAnalytics: () => request('/api/merchant/analytics'),
  merchantMenu: () => request('/api/merchant/menu'),
  merchantAddCategory: (body) => request('/api/merchant/menu/categories', { method: 'POST', body }),
  merchantUpdateCategory: (id, body) => request(`/api/merchant/menu/categories/${id}`, { method: 'PATCH', body }),
  merchantDeleteCategory: (id) => request(`/api/merchant/menu/categories/${id}`, { method: 'DELETE' }),
  merchantAddItem: (body) => request('/api/merchant/menu/items', { method: 'POST', body }),
  merchantUpdateItem: (id, body) => request(`/api/merchant/menu/items/${id}`, { method: 'PATCH', body }),
  merchantDeleteItem: (id) => request(`/api/merchant/menu/items/${id}`, { method: 'DELETE' }),

  // --- driver ratings (1-5 stars after a delivered order / completed trip) ---
  rateFoodDriver: (code, body) => request(`/api/food/orders/${code}/rate-driver`, { method: 'POST', body, silent: true }),
  rateRideDriver: (code, body) => request(`/api/bookings/${code}/rate-driver`, { method: 'POST', body, silent: true }),

  // --- food delivery: admin (admins run the restaurants — no owner accounts) ---
  adminFoodOverview: () => request('/api/admin/food/overview'),
  adminFoodMerchants: () => request('/api/admin/food/merchants'),
  adminFoodCreateMerchant: (body) => request('/api/admin/food/merchants', { method: 'POST', body }),
  adminFoodUpdateMerchant: (id, body) => request(`/api/admin/food/merchants/${id}`, { method: 'PATCH', body }),
  adminFoodDeleteMerchant: (id) => request(`/api/admin/food/merchants/${id}`, { method: 'DELETE' }),
  adminFoodSuspend: (id, reason) => request(`/api/admin/food/merchants/${id}/suspend`, { method: 'POST', body: { reason } }),
  adminFoodReactivate: (id) => request(`/api/admin/food/merchants/${id}/reactivate`, { method: 'POST' }),
  adminFoodCredit: (id, body) => request(`/api/admin/food/merchants/${id}/credit`, { method: 'POST', body }),
  adminFoodMerchantMenu: (id) => request(`/api/admin/food/merchants/${id}/menu`),
  adminFoodAddCategory: (id, body) => request(`/api/admin/food/merchants/${id}/menu/categories`, { method: 'POST', body }),
  adminFoodUpdateCategory: (catId, body) => request(`/api/admin/food/categories/${catId}`, { method: 'PATCH', body }),
  adminFoodDeleteCategory: (catId) => request(`/api/admin/food/categories/${catId}`, { method: 'DELETE' }),
  adminFoodAddItem: (id, body) => request(`/api/admin/food/merchants/${id}/menu/items`, { method: 'POST', body }),
  adminFoodModerateItem: (id, body) => request(`/api/admin/food/items/${id}`, { method: 'PATCH', body }),
  adminFoodDeleteItem: (id) => request(`/api/admin/food/items/${id}`, { method: 'DELETE' }),
  adminFoodOrders: (query = '') => request(`/api/admin/food/orders${query}`),
  adminFoodAcceptOrder: (code) => request(`/api/admin/food/orders/${code}/accept`, { method: 'POST', silent: true }),
  adminFoodRejectOrder: (code, reason) => request(`/api/admin/food/orders/${code}/reject`, { method: 'POST', body: { reason } }),
  adminFoodOrderStatus: (code, status) => request(`/api/admin/food/orders/${code}/status`, { method: 'PATCH', body: { status } }),
  adminFoodVerifyPayment: (code) => request(`/api/admin/food/orders/${code}/verify-payment`, { method: 'POST' }),
  adminFoodRejectPayment: (code, reason) => request(`/api/admin/food/orders/${code}/reject-payment`, { method: 'POST', body: { reason } }),
  adminFoodCancelOrder: (code, reason) => request(`/api/admin/food/orders/${code}/cancel`, { method: 'POST', body: { reason } }),
  adminFoodRefund: (code) => request(`/api/admin/food/orders/${code}/refund`, { method: 'POST' }),
  adminFoodOrderPhotos: (code) => request(`/api/admin/food/orders/${code}/photos`),
  adminFoodAssignDriver: (code, driver_id) => request(`/api/admin/food/orders/${code}/assign-driver`, { method: 'POST', body: { driver_id } }),
  // Merchant image upload (logo/menu photo) -> PUBLIC bucket signed URL.
  adminFoodMerchantImageSignedUrl: (id, body) =>
    request(`/api/admin/food/merchants/${id}/image/signed-url`, { method: 'POST', body }),
  // Owner account provisioning (contract-signing step).
  adminFoodSetMerchantOwner: (id, body) =>
    request(`/api/admin/food/merchants/${id}/owner`, { method: 'POST', body }),
};
