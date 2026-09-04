// ---------------------------------------------------------------------
// Admin — platform settings (0043).
//
// Readable by any admin, writable only by a super admin (the backend
// enforces both; the tab itself is hidden for a plain admin).
//
// One setting so far: the maximum distance. It replaced DELIVERY_MAX_RADIUS_KM,
// which lived only in the .env on the server, applied to food and shop but
// not to rides, and could not be seen from anywhere in the portal.
// ---------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { Ruler, Save } from 'lucide-react';
import { api } from '../lib/api';
import { notifySuccess } from '../lib/notify';
import { Card, Field, Spinner, inputClass, btnPrimary } from '../components/ui';

export default function SettingsView() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // noLimit is separate state rather than "km is empty" because null is a
  // real, deliberate value here — an empty box has to mean something else,
  // otherwise clearing the field to retype it would read as removing the cap.
  const [noLimit, setNoLimit] = useState(true);
  const [km, setKm] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await api.adminSettings();
        const value = res.max_distance_km;
        setNoLimit(value == null);
        setKm(value == null ? '' : String(value));
      } catch {
        /* surfaced by the api client */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.adminUpdateSettings({
        max_distance_km: noLimit ? null : Number(km),
      });
      const value = res.max_distance_km;
      setNoLimit(value == null);
      setKm(value == null ? '' : String(value));
      notifySuccess(value == null ? 'Distance limit removed.' : `Distance limit set to ${value} km.`);
    } catch {
      /* surfaced */
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Card className="p-4">
        <Spinner />
      </Card>
    );
  }

  const invalid = !noLimit && !(Number(km) > 0);

  return (
    <Card className="p-4 max-w-xl">
      <form onSubmit={save} className="space-y-4">
        <div className="flex items-start gap-3">
          <Ruler className="w-5 h-5 text-brand-orange mt-0.5 shrink-0" />
          <div>
            <h3 className="font-semibold">Maximum distance</h3>
            <p className="text-sm text-gray-500 mt-1">
              How far the platform will serve, measured in a straight line. This applies to
              Pick &amp; Drop rides <strong>and</strong> to food and shop deliveries — there is one
              answer for the whole platform. Anything further is refused at checkout.
            </p>
          </div>
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1"
            checked={noLimit}
            onChange={(e) => setNoLimit(e.target.checked)}
          />
          <span className="text-sm">
            <span className="font-medium">No limit</span>
            <span className="block text-gray-500">
              Accept any distance. A long airport transfer is a legitimate booking, so this is how
              the platform ships.
            </span>
          </span>
        </label>

        {!noLimit && (
          <Field label="Limit (km)">
            <input
              type="number"
              min="0.1"
              step="0.1"
              className={inputClass}
              value={km}
              onChange={(e) => setKm(e.target.value)}
              placeholder="e.g. 50"
            />
          </Field>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" className={btnPrimary} disabled={busy || invalid}>
            <Save className="w-4 h-4" />
            {busy ? 'Saving...' : 'Save'}
          </button>
          <span className="text-sm text-gray-500">
            {noLimit ? 'Currently: no limit' : `Currently: ${km || '--'} km`}
          </span>
        </div>

        <p className="text-xs text-gray-400">
          Takes effect within a minute — the backend caches this value briefly rather than reading
          it on every order.
        </p>
      </form>
    </Card>
  );
}
