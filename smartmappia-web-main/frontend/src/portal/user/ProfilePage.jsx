// ---------------------------------------------------------------------
// My Profile — /profile
// Edit personal info (name, phones, delivery address), upload a profile
// picture, and change email/password (Supabase Auth). Saves PATCH
// /api/auth/profile then refreshes the AuthProvider profile so the navbar
// picks the changes up instantly.
// ---------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, User, Phone, MapPin, Mail, KeyRound, Save, History, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthProvider';
import { MAX_NAME_LENGTH } from '../lib/fieldValidation';
import { supabase, uploadProofFile } from '../lib/supabaseClient';
import { compressImage } from '../lib/imageCompress';
import { notifySuccess, notifyError, confirmAction } from '../lib/notify';
import { getPasswordValidationError } from '../lib/passwordValidation';
import { PortalShell, Card, Field, Spinner, inputClass, btnPrimary, btnGhost } from '../components/ui';
import LocationPicker from '../components/LocationPicker';

function initialsOf(name, email) {
  const source = (name || email || '?').trim();
  const parts = source.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]).join('').toUpperCase();
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, profile, refreshProfile, signOut } = useAuth();
  const fileRef = useRef(null);

  const [form, setForm] = useState({
    fullName: profile?.fullName || '',
    mobile: profile?.mobile || '',
    whatsapp: profile?.whatsapp || '',
    address: profile?.address || '',
    coords: profile?.deliveryLat != null && profile?.deliveryLng != null
      ? { lat: profile.deliveryLat, lng: profile.deliveryLng }
      : null,
    street: profile?.deliveryStreet || '',
    buildingNumber: profile?.deliveryBuilding || '',
  });
  const [savingInfo, setSavingInfo] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState(null);

  const [email, setEmail] = useState(user?.email || '');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [savingSecurity, setSavingSecurity] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // A direct visit can render just before AuthProvider finishes loading the
  // profile. Hydrate once when it arrives, without later overwriting edits.
  const hydratedProfileRef = useRef(null);
  useEffect(() => {
    if (!profile?.id || hydratedProfileRef.current === profile.id) return;
    hydratedProfileRef.current = profile.id;
    setForm({
      fullName: profile.fullName || '',
      mobile: profile.mobile || '',
      whatsapp: profile.whatsapp || '',
      address: profile.address || '',
      coords: profile.deliveryLat != null && profile.deliveryLng != null
        ? { lat: profile.deliveryLat, lng: profile.deliveryLng }
        : null,
      street: profile.deliveryStreet || '',
      buildingNumber: profile.deliveryBuilding || '',
    });
  }, [profile]);

  async function saveInfo(e) {
    e.preventDefault();
    const hasAnyLocation = Boolean(
      form.address.trim() || form.coords || form.street.trim() || form.buildingNumber.trim()
    );
    if (hasAnyLocation && (!form.address.trim() || !form.coords || !form.street.trim() || !form.buildingNumber.trim())) {
      notifyError('Complete the delivery address, street, building number, and map pin before saving.');
      return;
    }
    setSavingInfo(true);
    try {
      await api.updateProfile({
        full_name: form.fullName.trim() || null,
        mobile_number: form.mobile.trim() || null,
        whatsapp_number: form.whatsapp.trim() || null,
        address: form.address.trim() || null,
        delivery_lat: form.coords?.lat ?? null,
        delivery_lng: form.coords?.lng ?? null,
        delivery_street: form.street.trim() || null,
        delivery_building: form.buildingNumber.trim() || null,
      });
      await refreshProfile();
      notifySuccess('Profile updated', 'Your information was saved.');
    } catch {
      /* api.js already showed the error popup */
    } finally {
      setSavingInfo(false);
    }
  }

  async function pickAvatar(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingAvatar(true);
    try {
      // Downscale before the size check, not after: a straight-off-the-camera
      // photo is comfortably over the limit at full resolution but well under
      // it once resized, and rejecting it would be pointless.
      const image = await compressImage(file);
      const { bucket, path, token, publicUrl, maxBytes } = await api.avatarSignedUrl({
        file_name: image.name,
        mime_type: image.type,
      });
      if (image.size > maxBytes) throw new Error('The image is too large (max 5 MB).');
      await uploadProofFile(bucket, path, token, image);
      await api.updateProfile({ avatar_url: publicUrl });
      setAvatarPreview(publicUrl);
      await refreshProfile();
      notifySuccess('Photo updated', 'Your profile picture was saved.');
    } catch (err) {
      if (err?.message && !err.status) notifyError(err.message);
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function saveSecurity(e) {
    e.preventDefault();
    if (!supabase) return;
    const wantsEmail = email.trim() && email.trim().toLowerCase() !== (user?.email || '').toLowerCase();
    const wantsPassword = password.length > 0;
    if (!wantsEmail && !wantsPassword) return;
    // Shared rule. This used to be a bare `< 6`, which was looser than both
    // signup and the admin-issued merchant passwords (8, lib/validate.js) —
    // and because this path calls supabase.auth.updateUser directly rather
    // than our API, that 8-character floor was not enforced here at all. A
    // merchant handed a compliant password could immediately downgrade it.
    if (wantsPassword) {
      const validationError = getPasswordValidationError(password);
      if (validationError) {
        notifyError(validationError);
        return;
      }
    }
    if (wantsPassword && password !== password2) {
      notifyError('Passwords do not match.');
      return;
    }
    setSavingSecurity(true);
    try {
      const { error } = await supabase.auth.updateUser({
        ...(wantsEmail ? { email: email.trim() } : {}),
        ...(wantsPassword ? { password } : {}),
      });
      if (error) throw error;
      setPassword('');
      setPassword2('');
      notifySuccess(
        'Account updated',
        wantsEmail
          ? 'Check your inbox — the email change must be confirmed from the new address.'
          : 'Your password was changed.'
      );
    } catch (err) {
      notifyError(err.message || 'Could not update your account.');
    } finally {
      setSavingSecurity(false);
    }
  }

  // Both app stores require an in-app way to delete an account. The server
  // refuses while a trip or order is still running and explains why, so the
  // error popup api.js raises is the right thing for the user to read.
  async function deleteAccount() {
    const confirmed = await confirmAction({
      title: 'Delete your account?',
      text: 'This removes your profile, contact details and saved addresses, and cannot be undone. Records of past payments are kept in anonymised form as required by tax law.',
      confirmText: 'Delete permanently',
      danger: true,
      requireText: 'DELETE',
    });
    if (!confirmed) return;

    setDeleting(true);
    try {
      await api.deleteAccount();
      notifySuccess('Account deleted', 'Your account has been removed.');
      await signOut();
      navigate('/', { replace: true });
    } catch {
      /* api.js already showed the error popup */
    } finally {
      setDeleting(false);
    }
  }

  const avatarUrl = avatarPreview || profile?.avatarUrl || null;

  return (
    <PortalShell title="My profile" subtitle="Manage your account" onBack={() => navigate('/home')}>
      <div className="max-w-2xl mx-auto space-y-5 pb-10">
        <Card className="p-6 flex flex-col sm:flex-row items-center gap-5">
          <div className="relative shrink-0">
            <div className="w-24 h-24 rounded-full overflow-hidden bg-gradient-to-br from-brand-orange to-brand-red flex items-center justify-center ring-4 ring-brand-orange/15">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <span className="text-white text-2xl font-black">
                  {initialsOf(profile?.fullName, user?.email)}
                </span>
              )}
            </div>
            <button
              type="button"
              disabled={uploadingAvatar}
              onClick={() => fileRef.current?.click()}
              className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-brand-orange text-white flex items-center justify-center shadow-lg cursor-pointer hover:bg-brand-orange/90 disabled:opacity-60"
              title="Change photo"
            >
              {uploadingAvatar ? (
                <Spinner className="!w-4 !h-4 !border-white/40 !border-t-white" />
              ) : (
                <Camera className="w-4 h-4" />
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={pickAvatar}
            />
          </div>
          <div className="text-center sm:text-left min-w-0">
            <p className="font-black text-brand-black text-xl truncate">
              {profile?.fullName || 'Add your name'}
            </p>
            <p className="text-sm text-brand-grey truncate">{user?.email}</p>
            <button
              type="button"
              onClick={() => navigate('/transactions')}
              className={btnGhost + ' !py-2 !px-3.5 !text-xs mt-3'}
            >
              <History className="w-3.5 h-3.5" /> Order history
            </button>
          </div>
        </Card>

        <Card className="p-6">
          <p className="font-black text-brand-black mb-4 flex items-center gap-2">
            <User className="w-4 h-4 text-brand-orange" /> Personal information
          </p>
          <form onSubmit={saveInfo} className="space-y-3">
            <Field label="Full name">
              <input value={form.fullName} onChange={set('fullName')} className={inputClass} placeholder="Your name" maxLength={MAX_NAME_LENGTH} />
            </Field>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Mobile number">
                <div className="relative">
                  <Phone className="w-4 h-4 text-brand-grey absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input value={form.mobile} onChange={set('mobile')} className={inputClass + ' !pl-10'} placeholder="05XXXXXXXX" />
                </div>
              </Field>
              <Field label="WhatsApp number">
                <div className="relative">
                  <Phone className="w-4 h-4 text-brand-grey absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input value={form.whatsapp} onChange={set('whatsapp')} className={inputClass + ' !pl-10'} placeholder="05XXXXXXXX" />
                </div>
              </Field>
            </div>
            <div className="pt-2 border-t border-brand-border">
              <p className="font-black text-brand-black mb-1 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-brand-orange" /> Saved delivery location
              </p>
              <p className="text-xs text-brand-grey mb-3">
                Food and shop checkout will automatically use this address and map pin.
              </p>
              <LocationPicker
                label="Delivery address"
                placeholder="Search nearby places, streets, or districts"
                address={form.address}
                coords={form.coords}
                street={form.street}
                buildingNumber={form.buildingNumber}
                requireStreetAndBuilding
                onChange={({ address, coords, street, buildingNumber }) => {
                  setForm((current) => ({
                    ...current,
                    address: address || '',
                    coords: coords || null,
                    street: street || '',
                    buildingNumber: buildingNumber || '',
                  }));
                }}
              />
            </div>
            <button type="submit" disabled={savingInfo} className={btnPrimary + ' w-full'}>
              {savingInfo ? <Spinner className="!border-white/40 !border-t-white" /> : (<><Save className="w-4 h-4" /> Save changes</>)}
            </button>
          </form>
        </Card>

        <Card className="p-6" id="settings">
          <p className="font-black text-brand-black mb-4 flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-brand-orange" /> Account &amp; security
          </p>
          <form onSubmit={saveSecurity} className="space-y-3">
            <Field label="Email address">
              <div className="relative">
                <Mail className="w-4 h-4 text-brand-grey absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass + ' !pl-10'} />
              </div>
            </Field>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="New password">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                  placeholder="Leave blank to keep"
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Confirm new password">
                <input
                  type="password"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  className={inputClass}
                  placeholder="Repeat the password"
                  autoComplete="new-password"
                />
              </Field>
            </div>
            <button type="submit" disabled={savingSecurity} className={btnPrimary + ' w-full'}>
              {savingSecurity ? <Spinner className="!border-white/40 !border-t-white" /> : (<><Save className="w-4 h-4" /> Update account</>)}
            </button>
          </form>
        </Card>

        <Card className="p-6 border-red-200">
          <p className="font-black text-red-600 mb-2 flex items-center gap-2">
            <Trash2 className="w-4 h-4" /> Delete account
          </p>
          <p className="text-sm text-brand-grey mb-4">
            Permanently delete your account and personal data. This cannot be undone.
          </p>
          <button
            type="button"
            onClick={deleteAccount}
            disabled={deleting}
            className={btnGhost + ' w-full !text-red-600 hover:!bg-red-50 disabled:opacity-50'}
          >
            {deleting ? <Spinner /> : (<><Trash2 className="w-4 h-4" /> Delete my account</>)}
          </button>
        </Card>
      </div>
    </PortalShell>
  );
}
