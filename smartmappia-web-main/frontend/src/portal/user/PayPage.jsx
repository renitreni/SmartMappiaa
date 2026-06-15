// ---------------------------------------------------------------------
// Standalone payment screen for an existing booking: /pay/:code
// Shows the STC Pay instructions + itemized fare, and lets the passenger
// upload their transfer screenshot. On success -> /track/:code.
// (The booking step lives in BookPage; this is the same UI, deep-linkable.)
// ---------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Upload, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';
import { uploadProofFile } from '../lib/supabaseClient';
import { PortalShell, Card, Field, inputClass, btnPrimary, Spinner } from '../components/ui';

export default function PayPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [instructions, setInstructions] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [error, setError] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.paymentInstructions(code).then(setInstructions).catch((e) => setLoadErr(e.message));
  }, [code]);

  async function submitProof() {
    if (!file) return setError('Please choose a screenshot of your STC Pay transfer.');
    setError(null);
    setBusy(true);
    try {
      const signed = await api.proofSignedUrl(code, { file_name: file.name, mime_type: file.type });
      await uploadProofFile(signed.bucket, signed.path, signed.token, file);
      await api.recordProof(code, { path: signed.path, file_name: file.name, mime_type: file.type, size_bytes: file.size });
      navigate(`/track/${code}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalShell title="Pay with STC Pay" subtitle={code} onBack={() => navigate('/')}>
      {loadErr && (
        <div className="max-w-xl mx-auto p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">{loadErr}</div>
      )}
      {!instructions && !loadErr && (
        <div className="flex justify-center py-20"><Spinner className="!w-8 !h-8" /></div>
      )}
      {instructions && (
        <div className="max-w-xl mx-auto">
          {error && <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">{error}</div>}
          <Card className="p-6">
            <div className="flex items-center gap-2 text-brand-orange font-black mb-1">
              <CheckCircle2 className="w-5 h-5" /> Booking created
            </div>
            <p className="text-sm text-brand-grey mb-5">
              Booking code <span className="font-mono font-bold text-brand-dark">{code}</span>
            </p>

            <div className="bg-brand-warm border border-brand-border rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-brand-grey">Send via STC Pay to</span><span className="font-bold">{instructions.stcPay.number || '—'}</span></div>
              <div className="flex justify-between"><span className="text-brand-grey">Recipient</span><span className="font-bold">{instructions.stcPay.recipientName}</span></div>
              {instructions.fare && (
                <>
                  <div className="flex justify-between"><span className="text-brand-grey">Base fare</span><span>SAR {instructions.fare.base.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-brand-grey">Service fee ({instructions.fare.serviceFeePercent}%)</span><span>SAR {instructions.fare.serviceFee.toFixed(2)}</span></div>
                </>
              )}
              <div className="flex justify-between pt-2 border-t border-brand-border"><span className="text-brand-grey font-bold">Total to pay</span><span className="font-black text-brand-orange">SAR {(instructions.fare?.total ?? instructions.amount)}</span></div>
              <div className="flex justify-between"><span className="text-brand-grey">Reference (note)</span><span className="font-mono font-bold">{instructions.reference}</span></div>
            </div>

            <ol className="list-decimal list-inside text-sm text-brand-dark mt-4 space-y-1">
              {instructions.instructions.map((s, i) => <li key={i}>{s}</li>)}
            </ol>

            <div className="mt-5">
              <Field label="Upload your STC Pay screenshot">
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className={inputClass + ' cursor-pointer file:mr-3 file:rounded-lg file:border-0 file:bg-brand-orange file:text-white file:px-3 file:py-1.5 file:font-bold'}
                />
              </Field>
              <button onClick={submitProof} disabled={busy} className={btnPrimary + ' w-full mt-4'}>
                {busy ? <Spinner className="!border-white/40 !border-t-white" /> : <><Upload className="w-4 h-4" /> Submit proof & track</>}
              </button>
              {instructions.testMode && (
                <p className="text-xs text-amber-600 mt-2 text-center font-medium">
                  Test mode is ON — your payment will auto-verify instantly.
                </p>
              )}
            </div>
          </Card>
        </div>
      )}
    </PortalShell>
  );
}
