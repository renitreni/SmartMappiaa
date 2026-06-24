// ---------------------------------------------------------------------
// User-facing alerts (SweetAlert2). Centralised so every error looks the
// same and QA can immediately see when something failed.
//
// notifyError is wired into the API client (api.js) so any failed request
// surfaces a popup automatically. Background/polling calls pass { silent }
// so they don't nag the user.
// ---------------------------------------------------------------------
import Swal from 'sweetalert2';

// Show one error popup at a time. The guard stops a failing poll loop (e.g.
// live tracking, the driver feed) from stacking dozens of identical popups.
export function notifyError(message) {
  if (Swal.isVisible()) return;
  Swal.fire({
    icon: 'error',
    title: 'Oops...',
    text: message || 'Something went wrong!',
    footer: '<a href="#">Why do I have this issue?</a>',
  });
}

// Optional helper for confirmations ("Booking cancelled", etc.).
export function notifySuccess(title, text) {
  Swal.fire({
    icon: 'success',
    title: title || 'Done',
    text,
    timer: 2200,
    showConfirmButton: false,
  });
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

// Auto-dismissing corner toast.
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
