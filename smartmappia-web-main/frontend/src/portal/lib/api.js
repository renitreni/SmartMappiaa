// ---------------------------------------------------------------------
// Backend client. Auth is automatic: if a Supabase session exists, every
// request carries `Authorization: Bearer <access_token>`, so the backend
// knows who the caller is and what role they have.
// ---------------------------------------------------------------------
import { supabase } from './supabaseClient';
<<<<<<< HEAD
=======
import { notifyError } from './notify';
>>>>>>> 0e76961b6c844daa651302735be3f95582c61c86

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';

async function authHeader() {
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

<<<<<<< HEAD
async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const auth = await authHeader();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...auth, ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
=======
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

>>>>>>> 0e76961b6c844daa651302735be3f95582c61c86
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
<<<<<<< HEAD
=======
    if (!silent) notifyError(msg);
>>>>>>> 0e76961b6c844daa651302735be3f95582c61c86
    throw err;
  }
  return data;
}

export const api = {
  base: API_BASE,

  // --- auth ---
  authSignup: (body) => request('/api/auth/signup', { method: 'POST', body }),
<<<<<<< HEAD
  authSync: (body = {}) => request('/api/auth/sync', { method: 'POST', body }),
=======
  authSync: (body = {}) => request('/api/auth/sync', { method: 'POST', body, silent: true }),
>>>>>>> 0e76961b6c844daa651302735be3f95582c61c86

  // --- passenger ---
  createBooking: (b) => request('/api/bookings', { method: 'POST', body: b }),
  getBooking: (code) => request(`/api/bookings/${code}`),
  cancelBooking: (code, reason) => request(`/api/bookings/${code}/cancel`, { method: 'POST', body: { reason } }),
  paymentInstructions: (code) => request(`/api/bookings/${code}/payment-instructions`),
  proofSignedUrl: (code, body) => request(`/api/bookings/${code}/payment-proof/signed-url`, { method: 'POST', body }),
  recordProof: (code, body) => request(`/api/bookings/${code}/payment-proof`, { method: 'POST', body }),
<<<<<<< HEAD
  tracking: (code) => request(`/api/tracking/${code}`),
=======
  tracking: (code) => request(`/api/tracking/${code}`, { silent: true }), // polled every 8s
>>>>>>> 0e76961b6c844daa651302735be3f95582c61c86

  // --- admin (role enforced by backend) ---
  adminStats: () => request('/api/admin/stats'),
  adminList: (query = '') => request(`/api/admin/bookings${query}`),
  adminDetail: (code) => request(`/api/admin/bookings/${code}`),
  adminVerify: (code, body = {}) => request(`/api/admin/bookings/${code}/verify-payment`, { method: 'POST', body }),
  adminReject: (code, reason) => request(`/api/admin/bookings/${code}/reject-payment`, { method: 'POST', body: { reason } }),
  adminAssign: (code, driver_id) => request(`/api/admin/bookings/${code}/assign-driver`, { method: 'POST', body: { driver_id } }),
  adminDrivers: () => request('/api/admin/drivers'),
  adminApproveDriver: (driverId, approved = true) =>
    request(`/api/admin/drivers/${driverId}/approval`, { method: 'POST', body: { approved } }),

  // --- driver (identity from token) ---
  driverAvailable: (lat, lng) => {
    const q = lat != null && lng != null ? `?lat=${lat}&lng=${lng}` : '';
<<<<<<< HEAD
    return request(`/api/driver/available${q}`);
  },
  driverRides: () => request('/api/driver/rides'),
  driverAccept: (code) => request(`/api/driver/rides/${code}/accept`, { method: 'POST' }),
  driverStatus: (code, status) => request(`/api/driver/rides/${code}/status`, { method: 'POST', body: { status } }),
  driverLocation: (body) => request('/api/driver/location', { method: 'POST', body }),
=======
    return request(`/api/driver/available${q}`, { silent: true }); // polled feed
  },
  driverRides: () => request('/api/driver/rides', { silent: true }), // polled feed
  driverAccept: (code) => request(`/api/driver/rides/${code}/accept`, { method: 'POST' }),
  driverStatus: (code, status) => request(`/api/driver/rides/${code}/status`, { method: 'POST', body: { status } }),
  driverLocation: (body) => request('/api/driver/location', { method: 'POST', body, silent: true }), // 12s GPS ping
>>>>>>> 0e76961b6c844daa651302735be3f95582c61c86
};
