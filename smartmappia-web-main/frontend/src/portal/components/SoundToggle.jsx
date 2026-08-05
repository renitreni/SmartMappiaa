// ---------------------------------------------------------------------
// "Enable sound" chip for the merchant dashboards.
//
// Browsers start an AudioContext suspended and will not let it run until
// the user has interacted with the page. Without this the new-order chime
// silently never fires on a freshly-opened dashboard — the worst kind of
// bug, because the merchant has no way to tell the feature is off.
//
// The chip only appears while sound is actually blocked, and disappears
// the moment it is unlocked. Clicking it also plays the chime once, so the
// merchant hears proof rather than trusting a label.
// ---------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { isOrderAlertBlocked, unlockOrderAlert, playOrderAlert } from '../lib/orderAlert';

export default function SoundToggle() {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const sync = () => setBlocked(isOrderAlertBlocked());
    sync();
    // Any click anywhere counts as the gesture the autoplay policy wants, so
    // a merchant who simply starts using the page gets sound without ever
    // seeing this chip. The listener re-checks rather than assuming success:
    // resume() is async and can still be refused.
    const onInteract = () => { unlockOrderAlert().then(sync); };
    window.addEventListener('pointerdown', onInteract);
    // Poll slowly as a backstop — the context can be suspended again by the
    // browser when a tab is backgrounded for a long time.
    const t = setInterval(sync, 5000);
    return () => {
      window.removeEventListener('pointerdown', onInteract);
      clearInterval(t);
    };
  }, []);

  if (!blocked) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[11px] font-bold text-green-600"
        title="New orders will play a sound"
      >
        <Volume2 className="w-3.5 h-3.5" /> Sound on
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => { unlockOrderAlert().then(() => { playOrderAlert(); setBlocked(isOrderAlertBlocked()); }); }}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-300 text-amber-800 text-[11px] font-bold hover:bg-amber-100 transition-colors cursor-pointer"
      title="Your browser is blocking sound until you interact with the page"
    >
      <VolumeX className="w-3.5 h-3.5" /> Enable sound
    </button>
  );
}
