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

export function notifyUnderDevelopment() {
  Swal.fire({
    icon: 'info',
    title: 'Under Development',
    text: 'The SmartMappia mobile application is currently under development. Check back soon!',
    showConfirmButton: false,
    timer: 2000,
  });
}
