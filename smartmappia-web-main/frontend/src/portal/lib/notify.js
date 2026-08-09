// ---------------------------------------------------------------------
// User-facing alerts (SweetAlert2). Centralised so every error looks the
// same and QA can immediately see when something failed.
//
// notifyError is wired into the API client (api.js) so any failed request
// surfaces a popup automatically. Background/polling calls pass { silent }
// so they don't nag the user.
// ---------------------------------------------------------------------
import Swal from 'sweetalert2';

const GENERIC_ERROR = 'Something went wrong on our side. Please try again in a moment.';

// Who is allowed to see diagnostic detail in a popup. Defaults to the SAFE
// answer (not an admin) so a message can never leak internals before the
// profile has loaded. AuthProvider keeps this in sync with the signed-in role.
let diagnosticsRole = null;
export function setDiagnosticsAudience(role) {
  diagnosticsRole = role || null;
}

// Text that means something to us and nothing to a customer: migration
// filenames, SQL/Postgres/Supabase internals, column and table names, stack
// noise. Showing any of it to an end user leaks our schema and deployment
// state, so non-admins get the generic line instead (the real message still
// goes to the console for QA).
const INTERNAL_MARKERS = [
  /migrations?\//i,
  /\.sql\b/i,
  /sql editor/i,
  /supabase/i,
  /postgres/i,
  /pgrst/i,
  /\brelation\b.*\bdoes not exist\b/i,
  /\bcolumn\b.*\bdoes not exist\b/i,
  /\bschema\b/i,
  /\bconstraint\b/i,
  /\bstack\b/i,
  /\bundefined is not\b/i,
  /\bnull is not\b/i,
  /\bECONN|ETIMEDOUT|ENOTFOUND\b/,
  /\bat .*\(.*:\d+:\d+\)/, // stack frame
];

function isSafeForAudience(message) {
  if (!message) return false;
  if (diagnosticsRole === 'admin') return true; // admins QA the app; let them see it
  return !INTERNAL_MARKERS.some((re) => re.test(message));
}

/**
 * Public-facing error popup. Business messages ("Minimum order is SAR 30")
 * pass through unchanged; anything that looks like internal diagnostics is
 * replaced with a generic line for non-admins.
 */
export function notifyError(message) {
  const safe = isSafeForAudience(message);
  if (!safe && message) {
    // Keep the detail reachable for whoever is debugging, just not on screen.
    console.error('[notifyError suppressed for non-admin]', message);
  }
  if (Swal.isVisible()) return;
  Swal.fire({
    icon: 'error',
    title: 'Oops...',
    text: safe ? message : GENERIC_ERROR,
  });
}

export function notifySuccess(title, text) {
  Swal.fire({
    icon: 'success',
    title: title || 'Done',
    text,
    timer: 2200,
    showConfirmButton: false,
  });
}

// requireText: for actions that cannot be undone, make the user type a word
// before Confirm does anything, so a mis-tap can never trigger it.
export async function confirmAction({
  title = 'Are you sure?',
  text,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  icon = 'warning',
  danger = false,
  requireText = null,
}) {
  const result = await Swal.fire({
    icon,
    title,
    text,
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: cancelText,
    confirmButtonColor: danger ? '#ef4444' : '#f97316',
    reverseButtons: true,
    focusCancel: true,
    ...(requireText
      ? {
          input: 'text',
          inputPlaceholder: requireText,
          inputAttributes: { autocapitalize: 'off', autocorrect: 'off' },
          preConfirm: (value) => {
            if ((value || '').trim().toUpperCase() !== requireText.toUpperCase()) {
              Swal.showValidationMessage(`Type ${requireText} to continue`);
              return false;
            }
            return true;
          },
        }
      : {}),
  });
  return result.isConfirmed;
}

// ---------------------------------------------------------------------
// Live ride alerts: a short chime + a corner toast. Used for "driver
// arrived" / "on the way to drop-off" style notifications (NOTES §5).
// ---------------------------------------------------------------------

// Two-tone chime via the Web Audio API — no asset file needed. Best-effort:
// browsers may keep the audio context suspended until a user gesture, so this
// is wrapped in try/catch and silently no-ops if it can't play.
let _audioCtx = null;
export function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    _audioCtx = _audioCtx || new Ctx();
    const ctx = _audioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = now + i * 0.18;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.36);
    });
  } catch {
    /* audio unavailable — ignore */
  }
}

export function notifyToast(title, opts = {}) {
  Swal.fire({
    toast: true,
    position: 'top-end',
    icon: opts.icon || 'info',
    title,
    showConfirmButton: false,
    timer: opts.timer || 4000,
    timerProgressBar: true,
  });
}

// Chime + toast together — the "ring the bell" alert for ride events.
export function notifyAlert(title, opts = {}) {
  playChime();
  notifyToast(title, opts);
}

export function notifyUnderDevelopment() {
  Swal.fire({
    icon: 'info',
    title: 'Under Development',
    text: 'The SmartMappia mobile application is currently under development. Check back soon!',
    showConfirmButton: false,
    timer: 2000,
  });
}

/** Restaurant listed but menu not ready yet — stay on discovery. */
export function notifyMenuUnavailable(restaurantName) {
  return Swal.fire({
    icon: 'info',
    title: 'Menu not available yet',
    html: restaurantName
      ? `<strong>${restaurantName}</strong> is coming soon.<br/>Please wait while we finish adding their menu.`
      : 'This restaurant’s menu is not available yet. Please wait while we fix this.',
    showConfirmButton: false,
    timer: 2000,
    timerProgressBar: true,
  });
}
