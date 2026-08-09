import { Link } from 'react-router-dom';
import { Mail, Phone, MessageCircle, MapPin, Clock } from 'lucide-react';
import { COMPANY } from '../../config/company';
import LegalLayout from './LegalLayout';

const CONTACTS = [
  { icon: Mail, label: 'Email', value: COMPANY.email, href: `mailto:${COMPANY.email}` },
  { icon: Phone, label: 'Phone', value: COMPANY.phoneDisplay, href: `tel:${COMPANY.phoneTel}` },
  { icon: MessageCircle, label: 'WhatsApp', value: COMPANY.whatsappDisplay, href: COMPANY.whatsappUrl },
  { icon: MapPin, label: 'Address', value: COMPANY.address.full },
  { icon: Clock, label: 'Support hours', value: COMPANY.hours },
];

const FAQS = [
  {
    q: 'How do I book an airport transfer?',
    a: 'Sign in, open Book, choose whether you are heading to or from the airport, pick your district and terminal, then confirm. The fare is fixed and shown before you confirm.',
  },
  {
    q: 'How do I pay?',
    a: 'Transfer the displayed amount through STC Pay, then upload a clear photo of the transfer confirmation. Your booking is confirmed once we verify the payment.',
  },
  {
    q: 'Can I track my driver?',
    a: 'Yes. Once a driver is assigned, the tracking screen shows their position on the live map along with an estimated arrival time.',
  },
  {
    q: 'How do I cancel or get a refund?',
    a: `Contact support at ${COMPANY.email} with your booking reference. Cancellations follow our published guidelines and Saudi consumer protection rules.`,
  },
  {
    q: 'How do I delete my account?',
    a: 'Open Profile and use Delete Account at the bottom of the screen. If you have already uninstalled the app, see the account deletion page.',
  },
];

export default function HelpCenterPage() {
  return (
    <LegalLayout title="Help Center">
      <section className="space-y-3">
        <h2 className="font-black text-brand-black">Contact us</h2>
        <ul className="space-y-2">
          {CONTACTS.map(({ icon: Icon, label, value, href }) => (
            <li key={label} className="flex items-start gap-3 text-sm text-brand-grey">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-orange" />
              <span>
                <span className="font-semibold text-brand-black">{label}: </span>
                {href ? (
                  <a href={href} className="underline hover:text-brand-orange">
                    {value}
                  </a>
                ) : (
                  value
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 space-y-4">
        <h2 className="font-black text-brand-black">Frequently asked questions</h2>
        {FAQS.map(({ q, a }) => (
          <div key={q}>
            <h3 className="text-sm font-black text-brand-black">{q}</h3>
            <p className="mt-1 text-sm leading-relaxed text-brand-grey">{a}</p>
          </div>
        ))}
      </section>

      <section className="mt-8 space-y-2 text-sm text-brand-grey">
        <h2 className="font-black text-brand-black">Legal</h2>
        <div className="flex flex-wrap gap-4">
          <Link to="/privacy-policy" className="underline hover:text-brand-orange">
            Privacy Policy
          </Link>
          <Link to="/terms-of-service" className="underline hover:text-brand-orange">
            Terms of Service
          </Link>
          <Link to="/account-deletion" className="underline hover:text-brand-orange">
            Delete your account
          </Link>
        </div>
      </section>
    </LegalLayout>
  );
}
