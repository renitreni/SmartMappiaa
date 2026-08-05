// ---------------------------------------------------------------------
// The merchant's new-order alert.
//
// A restaurant with a phone on the counter needs to HEAR an order arrive.
// Until now `new_order` only triggered a silent list refresh, so an order
// could sit unaccepted until someone happened to glance at the screen.
//
// Synthesised with the Web Audio API rather than shipped as an mp3: no
// binary asset in the repo, no extra network fetch on a till that may be on
// hotel wifi, and the volume is ours to control rather than whatever a file
// was mastered at.
//
// TWO THINGS THAT MAKE THIS FIDDLIER THAN IT LOOKS:
//
//   1. AUTOPLAY POLICY. Browsers create the AudioContext in a 'suspended'
//      state and refuse to start it until the user has interacted with the
//      page. A merchant who opens the dashboard and walks away would get
//      SILENCE with no indication why. Hence unlockOrderAlert() and
//      isOrderAlertBlocked() — the portal wires them to a first-click
//      listener and an "Enable sound" chip.
//
//   2. ONCE PER ORDER, not once per event. Broadcast reconnects, refetches
//      and remounts all re-deliver new_order for an order already announced.
//      The seen-set below is what makes "once per order" true.
// ---------------------------------------------------------------------

// A three-tone rising chime. Loud on purpose — this competes with a busy
// kitchen — but built from short notes so it reads as a notification rather
// than an alarm.
const NOTES = [
  { freq: 880, start: 0, duration: 0.16 },   // A5
  { freq: 1174, start: 0.13, duration: 0.16 }, // D6
  { freq: 1568, start: 0.26, duration: 0.34 }, // G6
];

const PEAK_GAIN = 0.9;

let ctx = null;
const announced = new Set();

function audioContext() {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

// True when a sound would be swallowed by the autoplay policy. The portal
// shows its "Enable sound" affordance on this.
export function isOrderAlertBlocked() {
  const c = audioContext();
  return !!c && c.state === 'suspended';
}

// Call from a real user gesture (a click anywhere counts). Safe to call
// repeatedly and safe to call when already running.
export function unlockOrderAlert() {
  const c = audioContext();
  if (c && c.state === 'suspended') return c.resume().catch(() => {});
  return Promise.resolve();
}

// Play the chime once, right now, ignoring the seen-set. Used by the
// "Enable sound" button so the merchant hears proof it works.
export function playOrderAlert() {
  const c = audioContext();
  if (!c || c.state === 'suspended') return false;

  const now = c.currentTime;
  for (const note of NOTES) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    // Triangle carries further than a sine through room noise without the
    // harshness of a square wave.
    osc.type = 'triangle';
    osc.frequency.value = note.freq;

    // Ramp rather than switch: a hard gain change clicks audibly.
    const start = now + note.start;
    const end = start + note.duration;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(start);
    osc.stop(end + 0.02);
  }
  return true;
}

// The one the broadcast handler calls. Announces an order at most once for
// the lifetime of the page; returns true only if it actually made a sound.
export function announceNewOrder(orderCode) {
  // No code means we cannot dedupe. Announce it anyway — a missed order is
  // worse than a repeated chime — but do not poison the set with undefined.
  if (!orderCode) return playOrderAlert();
  if (announced.has(orderCode)) return false;
  announced.add(orderCode);
  return playOrderAlert();
}

// Testing/remount hygiene.
export function _resetAnnouncedOrders() {
  announced.clear();
}
