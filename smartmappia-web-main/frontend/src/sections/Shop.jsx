import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Clock,
  Gift,
  Package,
  ShoppingBag,
  Sparkles,
  Star,
} from "lucide-react";

const partnerStores = [
  {
    id: "pinas",
    name: "Pinas Supermarket",
    shortName: "Pinas",
    tagline: "Your favorite Filipino goods, delivered fresh",
    logo: "/brands/pinas-supermarket.png",
    accent: "#1D5FBF",
    accentDark: "#0E3E8A",
    tint: "#EAF1FE",
    rating: "4.8",
    delivery: "30-45 min",
    productCount: "500+",
    categories: ["Rice & Grains", "Pantry", "Snacks", "Beverages"],
  },
  {
    id: "al-wafa",
    name: "Al Wafa Hypermarket",
    shortName: "Al Wafa",
    tagline: "Everyday essentials & fresh groceries",
    logo: "/brands/al-wafa-hypermarket.png",
    accent: "#0B7A3E",
    accentDark: "#065A2D",
    tint: "#E7F6EE",
    rating: "4.9",
    delivery: "25-40 min",
    productCount: "800+",
    categories: ["Fresh Produce", "Dairy", "Pantry", "Bakery", "Snacks"],
  },
];

// Featured apparel drop. Showcase only, deliberately not a partner store and
// not shoppable, so it sits above the store grid rather than becoming a card.
const featuredMerch = {
  name: "Zumba Riyadh",
  image: "/promo/zumba-riyadh.jpg",
  eyebrow: "Featured merch",
  headline: "Zumba Riyadh apparel is available now.",
  blurb: "Tees, hoodies and mugs by ZIN Archie. Wear your passion, live the groove.",
};

// Featured brand band, shown under the store grid. Same reason as the merch
// banner: a brand showcase, not a grocery store with a product catalogue.
const featuredBrand = {
  name: "Zeyt'S Parfum Bar",
  logo: "/brands/zeyts-parfum-bar.jpg",
  tagline: "Signature scents, blended to order at the bar",
  categories: ["Oud", "Floral", "Fresh", "Unisex"],
  accent: "#111827",
  tint: "#F3F4F6",
};

const stats = [
  { value: "2", label: "Partner stores" },
  { value: "1,300+", label: "Products" },
  { value: "40 min", label: "Avg. delivery" },
];

const cardVariants = {
  hidden: { opacity: 0, y: 40 },
  visible: (index) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: index * 0.1, ease: "easeOut" },
  }),
};

// Wide featured banner. The ratio steps down on narrow screens because an 8:3
// crop is only ~117px tall on a 375px phone, which squashes artwork that has
// text baked into it. object-contain over a warm letterbox so nothing is ever
// cropped, and the whole block self-removes if the asset is missing rather
// than leaving an empty box the width of the section.
function FeaturedMerchBanner({ merch }) {
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

// Featured brand band. Mirrors the store-card language (logo box, chips, CTA)
// without a product grid, so no prices are implied for a brand whose catalogue
// we do not carry yet.
function FeaturedBrandBand({ brand }) {
  const [logoFailed, setLogoFailed] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className="mt-12 rounded-3xl border border-brand-border bg-white overflow-hidden shadow-sm"
    >
      <div
        className="px-6 md:px-8 py-8 md:py-10 flex flex-col lg:flex-row lg:items-center gap-6"
        style={{
          background: `linear-gradient(135deg, ${brand.tint} 0%, #ffffff 55%, ${brand.tint} 100%)`,
        }}
      >
        <div className="w-20 h-20 md:w-28 md:h-28 rounded-2xl bg-white border border-brand-border flex items-center justify-center p-3 shrink-0">
          {logoFailed ? (
            <Sparkles className="w-8 h-8 text-brand-grey/40" strokeWidth={2} />
          ) : (
            <img
              src={brand.logo}
              alt={`${brand.name} logo`}
              loading="lazy"
              onError={() => setLogoFailed(true)}
              className="max-h-full max-w-full object-contain"
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center gap-2 text-[11px] font-bold tracking-widest uppercase text-brand-orange">
            <Sparkles className="w-3.5 h-3.5" strokeWidth={2.5} />
            New on Smart Mappia
          </span>
          <h3 className="text-2xl md:text-3xl font-black text-brand-black tracking-tight mt-1">
            {brand.name}
          </h3>
          <p className="text-brand-grey text-sm font-medium mt-1">{brand.tagline}</p>
          <div className="flex flex-wrap gap-2 mt-4">
            {brand.categories.map((category) => (
              <span
                key={category}
                className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full border"
                style={{
                  color: brand.accent,
                  borderColor: `${brand.accent}33`,
                  backgroundColor: `${brand.accent}0D`,
                }}
              >
                {category}
              </span>
            ))}
          </div>
        </div>

        <Link
          to="/shop"
          className="shrink-0 inline-flex items-center justify-center gap-2 text-white font-black text-sm px-7 py-3.5 rounded-xl transition-all duration-300 hover:scale-[1.02] active:scale-95 shadow-lg w-full lg:w-auto"
          style={{
            backgroundColor: brand.accent,
            boxShadow: `0 10px 24px -12px ${brand.accent}88`,
          }}
        >
          Explore {brand.name.split(" ")[0]}
          <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
        </Link>
      </div>
    </motion.div>
  );
}

// Compact, scalable store card — deliberately mirrors RestaurantCard's shape
// (image tile + badges, name, footer reveal) rather than the old full panel
// with an inline product grid per store, so this grid still reads cleanly
// whether there are 2 partner stores or 50. The full catalog per store lives
// on the real /shop/s/:id page, not here — the marketing grid always routes
// to /shop rather than guessing a store's backend id.
function StoreCard({ store, index }) {
  return (
    <Link to="/shop" className="block">
      <motion.article
        custom={index}
        variants={cardVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-50px" }}
        className="group relative bg-white border border-brand-border rounded-3xl overflow-hidden transition-all duration-300 hover:-translate-y-2 hover:border-brand-orange/30 hover:shadow-2xl hover:shadow-brand-orange/10"
      >
        <div
          className="relative h-40 sm:h-44 flex items-center justify-center overflow-hidden"
          style={{
            background: `linear-gradient(145deg, ${store.tint} 0%, #ffffff 60%, ${store.tint} 100%)`,
          }}
        >
          <div className="w-20 h-20 rounded-2xl bg-white border border-brand-border shadow-sm flex items-center justify-center p-3">
            <img
              src={store.logo}
              alt={`${store.name} logo`}
              className="max-h-full max-w-full object-contain"
            />
          </div>

          <div className="absolute top-4 right-4 flex items-center gap-1 bg-white/95 backdrop-blur-sm text-brand-black text-xs font-black px-2.5 py-1.5 rounded-full shadow-md">
            <Star className="w-3.5 h-3.5 text-brand-orange fill-brand-orange" strokeWidth={0} />
            {store.rating}
          </div>

          <span className="absolute bottom-4 left-4 inline-flex items-center gap-1.5 bg-white/95 backdrop-blur-sm text-brand-dark text-xs font-bold px-3 py-1.5 rounded-full shadow-sm">
            <Clock className="w-3.5 h-3.5 text-brand-orange" strokeWidth={2.5} />
            {store.delivery}
          </span>
        </div>

        <div className="p-5 sm:p-6">
          <h3 className="text-lg font-black text-brand-black tracking-tight group-hover:text-brand-orange transition-colors leading-snug mb-1.5">
            {store.name}
          </h3>
          <p className="text-brand-grey text-sm font-medium mb-4">{store.tagline}</p>

          <div className="flex flex-wrap gap-1.5 mb-4">
            {store.categories.slice(0, 3).map((cat) => (
              <span
                key={cat}
                className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full border"
                style={{
                  color: store.accent,
                  borderColor: `${store.accent}33`,
                  backgroundColor: `${store.accent}0D`,
                }}
              >
                {cat}
              </span>
            ))}
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-brand-border">
            <span className="inline-flex items-center gap-1 text-xs text-brand-grey font-medium">
              <Package className="w-3.5 h-3.5 text-brand-orange" strokeWidth={2.5} />
              {store.productCount} items
            </span>
            <span className="inline-flex items-center gap-1.5 text-sm font-bold text-brand-orange opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300">
              Shop Now
              <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
            </span>
          </div>
        </div>
      </motion.article>
    </Link>
  );
}

const Shop = () => {
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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-7">
          {partnerStores.map((store, index) => (
            <StoreCard key={store.id} store={store} index={index} />
          ))}
        </div>

        <FeaturedBrandBand brand={featuredBrand} />

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
