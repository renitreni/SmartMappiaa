// ---------------------------------------------------------------------
// Food Delivery — shared payment panel (STC Pay manual + Tap deferred).
// Used by the checkout page right after the order is created and by the
// tracking page while payment_status is still awaiting/failed.
// Mirrors the Pick & Drop proof flow: signed upload URL -> direct upload
// to private Storage -> record. Only the reference is ever stored.
// ---------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { Upload, CreditCard } from 'lucide-react';
import { api } from '../lib/api';
import { uploadProofFile } from '../lib/supabaseClient';
import { validateUploadFile, UPLOAD_ACCEPT, UPLOAD_FORMATS_HINT } from '../lib/uploadFiles';
import { fmtSAR } from '../lib/constants';
import { Card, Field, fileInputClass, btnPrimary, btnGhost, Spinner } from '../components/ui';

export default function PaymentPanel({ code, onPaid }) {
  const [info, setInfo] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [error, setError] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tapBusy, setTapBusy] = useState(false);

  useEffect(() => {
    api.foodPaymentInfo(code).then(setInfo).catch((e) => setLoadErr(e.message));
  }, [code]);

  async function submitProof() {
    if (!file) return setError('Please choose a screenshot of your STC Pay transfer.');
    const check = validateUploadFile(file);
    if (!check.ok) return setError(check.error);

    setError(null);
    setBusy(true);
    try {
      const signed = await api.foodPaySignedUrl(code, { file_name: file.name, mime_type: check.mimeType });
      await uploadProofFile(signed.bucket, signed.path, signed.token, file);
      const result = await api.foodRecordPayment(code, {
        path: signed.path,
        file_name: file.name,
        mime_type: check.mimeType,
        size_bytes: file.size,
      });
      onPaid?.(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function payWithTap() {
    setError(null);
    setTapBusy(true);
    try {
      const { url } = await api.foodTapCharge(code);
      window.location.href = url; // hosted Tap page; webhook confirms
    } catch (err) {
      setError(err.message);
      setTapBusy(false);
    }
  }

  if (loadErr) {
    return (
      <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
        {loadErr}
      </div>
    );
  }
  if (!info) {
    return <div className="flex justify-center py-10"><Spinner className="!w-7 !h-7" /></div>;
  }

  return (
    <Card className="p-5 sm:p-6">
      <p className="font-black text-brand-black mb-1">Pay for your order</p>
      <p className="text-sm text-brand-grey mb-4">
        Order <span className="font-mono font-bold text-brand-dark">{info.orderCode}</span>
      </p>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
          {error}
        </div>
      )}
      {info.paymentStatus === 'failed' && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
          Your previous payment was not verified. Please try again or contact support.
        </div>
      )}

      {/* Method picker: STC Pay is the live path; Tap only when configured. */}
      {info.tapAvailable ? (
        <button type="button" onClick={payWithTap} disabled={tapBusy} className={btnGhost + ' w-full mb-4'}>
          {tapBusy ? <Spinner /> : <CreditCard className="w-4 h-4" />} Pay online with Tap
        </button>
      ) : (
        <div className="w-full mb-4 py-3 px-5 rounded-xl border border-dashed border-brand-border text-center text-sm text-brand-grey font-medium">
          <CreditCard className="w-4 h-4 inline mr-1.5 -mt-0.5" /> Tap online payment — coming soon
        </div>
      )}

      <div className="bg-brand-warm border border-brand-border rounded-xl p-4 space-y-2 text-sm">
        <div className="flex justify-between"><span className="text-brand-grey">Send via STC Pay to</span><span className="font-bold">{info.stcPay.number || 'Number pending'}</span></div>
        <div className="flex justify-between"><span className="text-brand-grey">Recipient</span><span className="font-bold">{info.stcPay.recipientName}</span></div>
        <div className="flex justify-between pt-2 border-t border-brand-border">
          <span className="text-brand-grey font-bold">Total to pay</span>
          <span className="font-black text-brand-orange">{fmtSAR(info.amount)}</span>
        </div>
        <div className="flex justify-between"><span className="text-brand-grey">Reference (note)</span><span className="font-mono font-bold">{info.reference}</span></div>
      </div>

      <ol className="list-decimal list-inside text-sm text-brand-dark mt-4 space-y-1">
        {info.instructions.map((s, i) => <li key={i}>{s}</li>)}
      </ol>

      <div className="mt-5">
        <Field label="Upload your STC Pay screenshot">
          <input
            type="file"
            accept={UPLOAD_ACCEPT}
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className={fileInputClass}
          />
        </Field>
        <p className="text-xs text-brand-grey mt-1.5">{UPLOAD_FORMATS_HINT}</p>
        <button onClick={submitProof} disabled={busy} className={btnPrimary + ' w-full mt-4'}>
          {busy ? <Spinner className="!border-white/40 !border-t-white" /> : <><Upload className="w-4 h-4" /> Submit proof</>}
        </button>
        {info.testMode && (
          <p className="text-xs text-amber-600 mt-2 text-center font-medium">
            Test mode is ON — your payment will auto-verify instantly.
          </p>
        )}
      </div>
    </Card>
  );
}
