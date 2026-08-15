// ---------------------------------------------------------------------
// Homepage store grid. Every card is a live merchant from
// GET /api/shop/stores — list one in admin and it appears here, delist it
// and it is gone.
//
// A brand that trades with us belongs in that grid, which means it belongs
// in the merchants table. Zeyt'S Parfum Bar used to sit under the grid as a
// hand-written "featured brand" band; it is a store, so it is onboarded in
// Admin > Ecommerce like every other store and appears here on its own.
//
// The merch banner below is the only hand-written content left, and it is a
// product drop rather than a merchant — nothing about it claims to be a
// listed store you can order from.
// ---------------------------------------------------------------------
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Gift, ShoppingBag, Sparkles } from "lucide-react";
import { useMarketingStores } from "../lib/useMarketingPartners";
import { deliveryFeeFromLabel } from "../portal/lib/constants";
import MarketingListingGrid from "../components/MarketingListingCard";

// Featured apparel drop. Showcase only, deliberately not a partner store and
// not shoppable, so it sits above the store grid rather than becoming a card.
export const featuredMerch = {
  name: "Zumba Riyadh",
  image: "/promo/zumba-riyadh.jpg",
  eyebrow: "Featured merch",
  headline: "Zumba Riyadh apparel is available now.",
  blurb: "Tees, hoodies and mugs by ZIN Archie. Wear your passion, live the groove.",
};

// Wide featured banner. The ratio steps down on narrow screens because an 8:3
// crop is only ~117px tall on a 375px phone, which squashes artwork that has
// text baked into it. object-contain over a warm letterbox so nothing is ever
// cropped, and the whole block self-removes if the asset is missing rather
// than leaving an empty box the width of the section.
export function FeaturedMerchBanner({ merch }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className="mb-10 rounded-3xl border border-brand-border overflow-hidden bg-linear-to-br from-brand-warm via-white to-brand-orange/5"
    >
      <div className="px-6 md:px-8 pt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-2 text-brand-orange text-[11px] font-bold tracking-widest uppercase">
            <Sparkles className="w-3.5 h-3.5" strokeWidth={2.5} />
            {merch.eyebrow}
          </span>
          <p className="text-lg md:text-xl font-black text-brand-black mt-1 leading-snug">
            {merch.headline}
          </p>
          <p className="text-brand-grey text-sm font-medium mt-1">{merch.blurb}</p>
        </div>
      </div>

      <div className="relative w-full aspect-[4/3] sm:aspect-[2/1] lg:aspect-[8/3] mt-4">
        <img
          src={merch.image}
          alt={`${merch.name} apparel collection`}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 w-full h-full object-contain p-4 sm:p-6"
        />
      </div>
    </motion.div>
  );
}

const Shop = () => {
  const navigate = useNavigate();
  const { partners: stores, total, loading, failed, delivery } = useMarketingStores();

  // Counts are real or absent. A dash while the request is in flight beats a
  // round number that turns out to be wrong a second later — and a dash when
  // it FAILED beats "0 partner stores", which is a claim about the business
  // rather than about the request.
  //
  // The minimum order used to be the third stat. It is gone: it is a rule you
  // meet at checkout, not a reason to shop here, and with the request failing
  // it read "SAR 0 min. order" — an inviting number that was simply wrong.
  const unknown = loading || failed;
  const stats = [
    { value: unknown ? "—" : String(total), label: "Partner stores" },
    // Never "Free": the fee is a floor that rises past the free radius, and
    // an unknown fee must render nothing rather than a promise.
    { value: (unknown ? null : deliveryFeeFromLabel(delivery)) ?? "—", label: "Delivery" },
  ];

  return (
    <section
      id="shop"
      className="relative w-full bg-brand-muted px-8 md:px-20 py-24 border-t border-brand-border overflow-hidden"
    >
      <div
        className="absolute top-0 right-0 w-[520px] h-[520px] bg-brand-orange/5 rounded-full blur-[120px] pointer-events-none"
        aria-hidden="true"
      />

      <div className="max-w-7xl mx-auto relative">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-10 mb-14">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="max-w-2xl"
          >
            <span className="inline-flex items-center gap-2 text-brand-orange text-sm font-bold tracking-widest uppercase">
              <ShoppingBag className="w-4 h-4" strokeWidth={2.5} />
              SmartMappia E-commerce
            </span>

            <h2 className="text-3xl md:text-5xl font-black tracking-tight text-brand-black mt-3 leading-tight">
              Groceries from trusted stores.{" "}
              <span className="text-transparent bg-clip-text bg-linear-to-r from-brand-orange to-brand-red">
                At your doorstep.
              </span>
            </h2>

            <p className="text-brand-grey text-sm md:text-base mt-4 font-medium leading-relaxed">
              Browse curated products from trusted partner stores near you. Filipino
              pantry staples, fresh groceries and everyday essentials, all with live
              delivery tracking.
            </p>

            <Link
              to="/shop"
              className="inline-flex items-center gap-2 mt-5 text-sm font-bold text-brand-orange hover:gap-3 transition-all"
            >
              See all stores
              <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
            </Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="flex flex-wrap gap-6 lg:gap-8"
          >
            {stats.map((stat) => (
              <div key={stat.label} className="text-center lg:text-right">
                <p className="text-2xl md:text-3xl font-black text-brand-black">
                  {stat.value}
                </p>
                <p className="text-brand-grey text-xs font-semibold uppercase tracking-wider mt-0.5">
                  {stat.label}
                </p>
              </div>
            ))}
          </motion.div>
        </div>

        <FeaturedMerchBanner merch={featuredMerch} />

        <MarketingListingGrid
          listings={stores}
          loading={loading}
          failed={failed}
          columns="sm:grid-cols-2 lg:grid-cols-3"
          ctaLabel="Shop Now"
          onOpen={(store) => navigate(`/shop/s/${store.id}`)}
          emptyText="No stores are listed yet. New partners appear here the moment they go live."
        />

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="mt-16 relative overflow-hidden rounded-3xl"
        >
          <div className="absolute inset-0 bg-linear-to-r from-brand-orange to-brand-red" />
          <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_top_right,white,transparent_60%)]" />

          <div className="relative z-10 p-8 md:p-12 flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="max-w-xl text-center md:text-left">
              <span className="inline-flex items-center gap-2 text-white/80 text-xs font-bold uppercase tracking-widest mb-3">
                <Sparkles className="w-3.5 h-3.5" strokeWidth={2.5} />
                Smart Rewards
              </span>
              <h3 className="text-2xl md:text-3xl font-black text-white mb-3 tracking-tight">
                Earn points on every purchase.
              </h3>
              <p className="text-white/85 text-sm md:text-base font-medium leading-relaxed flex items-start gap-2 justify-center md:justify-start">
                <Gift className="w-5 h-5 shrink-0 mt-0.5" strokeWidth={2.25} />
                Download SmartMappia to unlock exclusive deals, one-tap checkout, and
                live delivery tracking on every order.
              </p>
            </div>

            <Link
              to="/shop"
              className="w-full md:w-auto shrink-0 bg-white hover:bg-brand-warm text-brand-orange font-black text-sm px-8 py-4 rounded-xl transition-all duration-300 transform hover:scale-[1.02] active:scale-95 shadow-xl text-center"
            >
              Start Shopping
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default Shop;
