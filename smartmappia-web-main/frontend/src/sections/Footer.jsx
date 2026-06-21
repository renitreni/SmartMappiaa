import { openLegalModal } from "../portal/lib/legal";

const legalLinks = [
  { label: "Privacy Policy", kind: "privacy" },
  { label: "Terms of Service", kind: "terms" },
  { label: "Cookie Preferences", kind: null },
];

const exploreLinks = [
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Restaurants", href: "#restaurants" },
  { label: "Shop", href: "#shop" },
  { label: "Pick & Drop", href: "#pick-drop" },
];

const companyLinks = [
  { label: "About Us", href: "#about" },
  { label: "Careers", href: "#" },
  { label: "Blog", href: "#" },
  { label: "Partners", href: "#" },
  { label: "FAQ", href: "#faq" },
];

const socialLinks = [
  {
    label: "Instagram",
    path: "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z",
  },
  {
    label: "Twitter / X",
    path: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
  },
  {
    label: "Facebook",
    path: "M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z",
  },
  {
    label: "TikTok",
    path: "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z",
  },
];

const FooterLink = ({ href, children }) => (
  <a
    href={href}
    className="text-sm text-white/55 hover:text-brand-orange transition-colors duration-200 inline-flex items-center gap-1 group"
  >
    <span className="w-0 group-hover:w-2 h-px bg-brand-orange transition-all duration-200" />
    {children}
  </a>
);

const Footer = () => {
  return (
    <footer className="relative w-full bg-brand-black text-white overflow-hidden">
      {/* Logo-inspired gradient accent */}
      <div className="h-1 w-full bg-linear-to-r from-brand-orange via-orange-400 to-brand-red" />

      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute -top-40 right-0 w-[500px] h-[500px] rounded-full bg-brand-orange/8 blur-[120px]" />
        <div className="absolute bottom-0 -left-32 w-[400px] h-[400px] rounded-full bg-brand-red/6 blur-[100px]" />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
          }}
        />
      </div>

      {/* CTA strip */}
      <div className="relative z-10 border-b border-white/8">
        <div className="max-w-7xl mx-auto px-6 md:px-8 py-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-center md:text-left">
            <p className="text-xs font-bold tracking-widest uppercase text-brand-orange mb-1">
              Download the app
            </p>
            <h3 className="text-xl md:text-2xl font-black tracking-tight">
              Fast delivery.{" "}
              <span className="text-transparent bg-clip-text bg-linear-to-r from-brand-orange to-brand-red">
                One smart app.
              </span>
            </h3>
          </div>

          <div className="flex gap-3">
            <a
              href="#"
              className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl border border-white/12 bg-white/5 hover:bg-white/10 hover:border-brand-orange/40 transition-all duration-300 group"
            >
              <svg
                className="w-5 h-5 text-white/80 group-hover:text-brand-orange transition-colors"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
              </svg>
              <div className="flex flex-col leading-none">
                <span className="text-[10px] text-white/45">Download on the</span>
                <span className="text-xs font-semibold mt-0.5 text-white">App Store</span>
              </div>
            </a>

            <a
              href="#"
              className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl border border-white/12 bg-white/5 hover:bg-white/10 hover:border-brand-orange/40 transition-all duration-300 group"
            >
              <svg
                className="w-5 h-5 text-white/80 group-hover:text-brand-orange transition-colors"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M3.18 23.76c.3.17.65.19.97.07l12.93-7.47-2.79-2.79-11.11 10.19zM.5 1.77C.18 2.1 0 2.6 0 3.24v17.52c0 .64.18 1.14.51 1.47l.08.07 9.81-9.81v-.23L.58 1.7l-.08.07zM20.65 10.24L17.47 8.4l-3.07 3.07 3.07 3.07 3.19-1.85c.91-.53.91-1.39 0-1.92l-.01-.53zM3.18.24L16.11 7.71l-2.79 2.79L2.21.31C2.53.19 2.88.21 3.18.24z" />
              </svg>
              <div className="flex flex-col leading-none">
                <span className="text-[10px] text-white/45">Get it on</span>
                <span className="text-xs font-semibold mt-0.5 text-white">Google Play</span>
              </div>
            </a>
          </div>
        </div>
      </div>

      {/* Main grid */}
      <div className="relative z-10 max-w-7xl mx-auto px-6 md:px-8 pt-14 pb-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10 lg:gap-12">
          {/* Brand */}
          <div className="lg:col-span-2 flex flex-col gap-5">
            <a href="#home" className="flex items-center gap-3 group w-fit">
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-linear-to-br from-brand-orange to-brand-red blur-md opacity-40 group-hover:opacity-60 transition-opacity" />
                <img
                  src="/mappia-new-logo.png"
                  alt="SmartMappia Logo"
                  className="relative w-12 h-12 object-contain"
                />
              </div>
              <span className="text-lg font-black tracking-tight text-white">
                Smart{" "}
                <span className="text-transparent bg-clip-text bg-linear-to-r from-brand-orange to-brand-red">
                  Mappia
                </span>
              </span>
            </a>

            <p className="text-sm leading-relaxed max-w-xs text-white/50">
              Order food, send packages, and book airport transfers — all in one app
              with real-time tracking and exclusive rewards across Riyadh.
            </p>

            <div className="flex gap-2 mt-1">
              {socialLinks.map(({ label, path }) => (
                <a
                  key={label}
                  href="#"
                  aria-label={label}
                  className="w-9 h-9 rounded-xl flex items-center justify-center border border-white/10 bg-white/5 text-white/45 hover:text-white hover:border-transparent hover:bg-linear-to-br hover:from-brand-orange hover:to-brand-red transition-all duration-300"
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d={path} />
                  </svg>
                </a>
              ))}
            </div>
          </div>

          {/* Explore */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest mb-5 text-brand-orange">
              Explore
            </h4>
            <ul className="flex flex-col gap-3.5">
              {exploreLinks.map(({ label, href }) => (
                <li key={label}>
                  <FooterLink href={href}>{label}</FooterLink>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest mb-5 text-brand-orange">
              Company
            </h4>
            <ul className="flex flex-col gap-3.5">
              {companyLinks.map(({ label, href }) => (
                <li key={label}>
                  <FooterLink href={href}>{label}</FooterLink>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest mb-5 text-brand-orange">
              Contact
            </h4>
            <ul className="flex flex-col gap-4">
              <li className="flex items-start gap-3 text-sm text-white/55">
                <span className="shrink-0 w-8 h-8 rounded-lg bg-brand-orange/15 flex items-center justify-center">
                  <svg
                    className="w-4 h-4 text-brand-orange"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                </span>
                <span className="pt-1">support@smartmappia.com</span>
              </li>
              <li className="flex items-start gap-3 text-sm text-white/55">
                <span className="shrink-0 w-8 h-8 rounded-lg bg-brand-orange/15 flex items-center justify-center">
                  <svg
                    className="w-4 h-4 text-brand-orange"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                    />
                  </svg>
                </span>
                <span className="pt-1">+966 XX XXX XXXX</span>
              </li>
              <li className="flex items-start gap-3 text-sm text-white/55">
                <span className="shrink-0 w-8 h-8 rounded-lg bg-brand-orange/15 flex items-center justify-center">
                  <svg
                    className="w-4 h-4 text-brand-orange"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </span>
                <span className="pt-1">Daily, 7 AM – midnight</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="relative z-10 border-t border-white/8">
        <div className="max-w-7xl mx-auto px-6 md:px-8 py-5 flex flex-col md:flex-row items-center justify-between gap-3">
          <p className="text-xs text-white/35">
            © 2026{" "}
            <span className="text-transparent bg-clip-text bg-linear-to-r from-brand-orange to-brand-red font-semibold">
              Smart Mappia
            </span>
            . All rights reserved.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            {legalLinks.map(({ label, kind }, i, arr) => (
              <span key={label} className="flex items-center gap-5">
                {kind ? (
                  <button
                    type="button"
                    onClick={() => openLegalModal(kind)}
                    className="text-xs text-white/35 hover:text-white/70 transition-colors duration-200 cursor-pointer"
                  >
                    {label}
                  </button>
                ) : (
                  <a
                    href="#"
                    className="text-xs text-white/35 hover:text-white/70 transition-colors duration-200"
                  >
                    {label}
                  </a>
                )}
                {i < arr.length - 1 && (
                  <span className="text-white/15 hidden sm:inline">·</span>
                )}
              </span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
