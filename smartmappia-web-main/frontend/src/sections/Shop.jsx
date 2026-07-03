import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  Clock,
  Gift,
  MapPin,
  Package,
  Plus,
  ShoppingBag,
  Sparkles,
  Star,
  Truck,
} from "lucide-react";
import { notifyUnderDevelopment } from "../portal/lib/notify";

const CATEGORY_EMOJI = {
  "Rice & Grains": "🍚",
  Pantry: "🫙",
  Snacks: "🍿",
  Beverages: "🥤",
  "Fresh Produce": "🥬",
  Dairy: "🥛",
  Bakery: "🥖",
  Household: "🧴",
  "Personal Care": "🧼",
  General: "🛒",
};

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
    delivery: "30–45 min",
    productCount: "500+",
    categories: ["Rice & Grains", "Pantry", "Snacks", "Beverages"],
    products: [
      { name: "Jasmine Rice 25kg", price: 189, category: "Rice & Grains", unit: "25 kg bag", emoji: "🍚", image: "/products/jasmine-rice.jpg" },
      { name: "Banana Ketchup", price: 12, category: "Pantry", unit: "320 g bottle", emoji: "🍅", image: "/products/banana-ketchup.jpg" },
      { name: "Dried Mangoes", price: 28, category: "Snacks", unit: "200 g pack", emoji: "🥭", image: "/products/dried-mangoes.jpg" },
      { name: "Pancit Canton (10s)", price: 22, category: "Pantry", unit: "10-pack", emoji: "🍜", image: "/products/pancit-canton.jpg" },
      { name: "Coconut Milk", price: 9, category: "Pantry", unit: "400 ml can", emoji: "🥥", image: "/products/coconut-milk.jpg" },
      { name: "3-in-1 Coffee", price: 18, category: "Beverages", unit: "10 sachets", emoji: "☕", image: "/products/instant-coffee.jpg" },
      { name: "Calamansi Juice 1L", price: 15, category: "Beverages", unit: "1 L bottle", emoji: "🍋", image: "/products/calamansi-juice.jpg" },
      { name: "Ube Halaya Jar", price: 35, category: "Snacks", unit: "450 g jar", emoji: "🍠", image: "/products/ube-halaya.jpg" },
    ],
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
    delivery: "25–40 min",
    productCount: "800+",
    categories: ["Fresh Produce", "Dairy", "Pantry", "Bakery"],
    products: [
      { name: "Fresh Ajwa Dates", price: 45, category: "Fresh Produce", unit: "500 g box", emoji: "🌴", image: "/products/ajwa-dates.jpg" },
      { name: "Olive Oil 1L", price: 39, category: "Pantry", unit: "1 L bottle", emoji: "🫒", image: "/products/olive-oil.jpg" },
      { name: "Basmati Rice 5kg", price: 55, category: "Pantry", unit: "5 kg bag", emoji: "🍚", image: "/products/basmati-rice.jpg" },
      { name: "Arabic Coffee", price: 32, category: "Pantry", unit: "250 g pack", emoji: "☕", image: "/products/arabic-coffee.jpg" },
      { name: "Fresh Laban", price: 7, category: "Dairy", unit: "1 L carton", emoji: "🥛", image: "/products/fresh-laban.jpg" },
      { name: "Mixed Nuts", price: 60, category: "Snacks", unit: "400 g tin", emoji: "🥜", image: "/products/mixed-nuts.jpg" },
      { name: "Fresh Pita Bread", price: 8, category: "Bakery", unit: "6 pcs pack", emoji: "🫓", image: "/products/pita-bread.jpg" },
      { name: "Fresh Vegetables Box", price: 38, category: "Fresh Produce", unit: "Mixed box", emoji: "🥗", image: "/products/vegetables-box.jpg" },
    ],
  },
  {
    id: "happy-ending",
    name: "Happy Ending General Store",
    shortName: "Happy Ending",
    tagline: "Your one-stop general store — groceries, snacks & essentials",
    logo: "/brands/happy-ending.png",
    accent: "#DC2626",
    accentDark: "#991B1B",
    tint: "#FEF3C7",
    rating: "4.7",
    delivery: "20–35 min",
    productCount: "350+",
    categories: ["Snacks", "Pantry", "Beverages", "Household", "Personal Care"],
    products: [
      { name: "BBQ Skewers Pack", price: 18, category: "Snacks", unit: "5 pcs pack", emoji: "🍢", image: "/products/bbq-skewers.jpg" },
      { name: "Fishball Snack Cup", price: 12, category: "Snacks", unit: "Large cup", emoji: "🍡", image: "/products/fishball-snack.jpg" },
      { name: "Potato Chips", price: 8, category: "Snacks", unit: "150 g bag", emoji: "🥔", image: "/products/potato-chips.jpg" },
      { name: "Instant Noodles (5s)", price: 15, category: "Pantry", unit: "5-pack", emoji: "🍜", image: "/products/pancit-canton.jpg" },
      { name: "Soft Drinks 1.5L", price: 6, category: "Beverages", unit: "1.5 L bottle", emoji: "🥤", image: "/products/calamansi-juice.jpg" },
      { name: "3-in-1 Coffee", price: 18, category: "Beverages", unit: "10 sachets", emoji: "☕", image: "/products/instant-coffee.jpg" },
      { name: "Household Cleaner", price: 22, category: "Household", unit: "750 ml bottle", emoji: "🧴", image: "/products/household-cleaner.jpg" },
      { name: "Toilet Paper (12 roll)", price: 28, category: "Household", unit: "12 rolls", emoji: "🧻", image: "/products/toilet-paper.jpg" },
    ],
  },
];

const stats = [
  { value: "3", label: "Partner stores" },
  { value: "1,500+", label: "Products" },
  { value: "40 min", label: "Avg. delivery" },
];

const formatPrice = (value) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 0 });

function ProductThumbnail({ product, store, compact = false }) {
  const [failed, setFailed] = useState(false);
  const showImage = product.image && !failed;

  if (showImage) {
    return (
      <div className="relative w-full h-full overflow-hidden bg-white">
        <img
          src={product.image}
          alt={product.name}
          onError={() => setFailed(true)}
          className={`w-full h-full object-cover transition-transform duration-500 ${
            compact ? "" : "group-hover/item:scale-105"
          }`}
        />
        {!compact && (
          <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/55 via-black/20 to-transparent px-3 py-2.5">
            <p
              className="text-[9px] font-bold uppercase tracking-wide text-white/90"
            >
              {product.category}
            </p>
          </div>
        )}
      </div>
    );
  }

  const categoryEmoji = CATEGORY_EMOJI[product.category] ?? "🛒";

  return (
    <div
      className={`relative w-full h-full flex flex-col items-center justify-center overflow-hidden ${
        compact ? "p-2" : "p-4"
      }`}
      style={{
        background: `linear-gradient(145deg, ${store.tint} 0%, #ffffff 45%, ${store.tint} 100%)`,
      }}
    >
      <div
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(${store.accent} 1.5px, transparent 1.5px)`,
          backgroundSize: "14px 14px",
        }}
      />
      <div
        className={`relative flex items-center justify-center rounded-2xl bg-white/90 border shadow-sm ${
          compact ? "w-10 h-10 text-xl mb-0" : "w-20 h-20 md:w-24 md:h-24 text-4xl md:text-5xl mb-3"
        }`}
        style={{ borderColor: `${store.accent}33` }}
      >
        <span role="img" aria-label={product.name}>
          {product.emoji}
        </span>
      </div>

      {!compact && (
        <>
          <p
            className="relative text-[10px] font-bold uppercase tracking-wider mb-1"
            style={{ color: store.accent }}
          >
            {product.category}
          </p>
          <p className="relative text-xs font-black text-brand-black text-center leading-snug line-clamp-2 px-2">
            {product.name}
          </p>
          <p className="relative text-[10px] text-brand-grey font-medium mt-1">
            {categoryEmoji} {product.unit}
          </p>
        </>
      )}
    </div>
  );
}

function ProductCard({ product, store }) {
  return (
    <div className="group/item flex flex-col rounded-2xl border border-brand-border bg-white overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-brand-orange/25 hover:shadow-lg hover:shadow-brand-orange/10">
      <div className="relative aspect-square overflow-hidden bg-brand-surface">
        <ProductThumbnail product={product} store={store} />
        <button
          type="button"
          onClick={notifyUnderDevelopment}
          aria-label={`Add ${product.name} to cart`}
          className="absolute bottom-2.5 right-2.5 w-9 h-9 rounded-xl text-white flex items-center justify-center shadow-lg opacity-0 translate-y-1 group-hover/item:opacity-100 group-hover/item:translate-y-0 transition-all duration-300 cursor-pointer"
          style={{ backgroundColor: store.accent }}
        >
          <Plus className="w-4 h-4" strokeWidth={2.5} />
        </button>
      </div>
      <div className="p-3.5 flex flex-col flex-1">
        <p className="text-sm font-black text-brand-black leading-snug line-clamp-2 group-hover/item:text-brand-orange transition-colors">
          {product.name}
        </p>
        <p className="text-[10px] text-brand-grey font-medium mt-1">{product.unit}</p>
        <div className="flex items-center justify-between mt-auto pt-3">
          <p className="text-base font-black text-brand-orange">
            SAR {formatPrice(product.price)}
          </p>
          <button
            type="button"
            onClick={notifyUnderDevelopment}
            className="md:hidden w-8 h-8 rounded-lg text-white flex items-center justify-center cursor-pointer"
            style={{ backgroundColor: store.accent }}
            aria-label={`Add ${product.name}`}
          >
            <Plus className="w-4 h-4" strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}

function StorePanel({ store, index }) {
  const featured = store.products.slice(0, 3);
  const rest = store.products.slice(3);

  return (
    <motion.article
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.55, delay: index * 0.1 }}
      className="rounded-3xl border border-brand-border bg-white overflow-hidden shadow-sm"
    >
      <div
        className="relative px-6 md:px-8 py-8 md:py-10 overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${store.tint} 0%, #ffffff 55%, ${store.tint} 100%)`,
        }}
      >
        <div
          className="absolute -top-16 -right-16 w-64 h-64 rounded-full opacity-30 blur-3xl pointer-events-none"
          style={{ backgroundColor: store.accent }}
        />

        <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="flex items-start sm:items-center gap-4 md:gap-5">
            <div className="w-20 h-20 md:w-28 md:h-28 rounded-2xl bg-white border border-brand-border shadow-md flex items-center justify-center p-3 shrink-0">
              <img
                src={store.logo}
                alt={`${store.name} logo`}
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span
                  className="inline-flex items-center gap-1 text-xs font-black text-white px-2.5 py-1 rounded-full"
                  style={{ backgroundColor: store.accent }}
                >
                  <Star className="w-3.5 h-3.5 fill-white" strokeWidth={0} />
                  {store.rating}
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-bold text-brand-dark bg-white/90 border border-brand-border px-2.5 py-1 rounded-full">
                  <Clock className="w-3.5 h-3.5" strokeWidth={2.5} />
                  {store.delivery}
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-bold text-brand-dark bg-white/90 border border-brand-border px-2.5 py-1 rounded-full">
                  <Package className="w-3.5 h-3.5" strokeWidth={2.5} />
                  {store.productCount} items
                </span>
              </div>
              <h3 className="text-2xl md:text-3xl font-black text-brand-black tracking-tight">
                {store.name}
              </h3>
              <p className="text-brand-grey text-sm md:text-base font-medium mt-1 max-w-lg">
                {store.tagline}
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                {store.categories.map((cat) => (
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
            </div>
          </div>

          <button
            type="button"
            onClick={notifyUnderDevelopment}
            className="shrink-0 inline-flex items-center justify-center gap-2 text-white font-black text-sm px-7 py-3.5 rounded-xl transition-all duration-300 hover:scale-[1.02] active:scale-95 shadow-lg cursor-pointer w-full lg:w-auto"
            style={{
              backgroundColor: store.accent,
              boxShadow: `0 10px 30px -8px ${store.accent}66`,
            }}
          >
            Shop at {store.shortName}
            <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
          </button>
        </div>
      </div>

      <div className="px-6 md:px-8 py-6 md:py-8 border-t border-brand-border bg-brand-muted/40">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-black text-brand-black uppercase tracking-widest">
            Bestsellers
          </h4>
          <button
            type="button"
            onClick={notifyUnderDevelopment}
            className="text-xs font-bold cursor-pointer hover:underline"
            style={{ color: store.accent }}
          >
            View all products
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {featured.map((product) => (
            <div
              key={product.name}
              className="flex items-center gap-3 p-3 rounded-2xl bg-white border border-brand-border hover:border-brand-orange/25 hover:shadow-md transition-all duration-300 group/feat"
            >
              <div className="w-16 h-16 rounded-xl overflow-hidden shrink-0 border border-brand-border">
                <ProductThumbnail product={product} store={store} compact />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black text-brand-black line-clamp-2 leading-snug">
                  {product.name}
                </p>
                <p className="text-sm font-black text-brand-orange mt-1">
                  SAR {formatPrice(product.price)}
                </p>
              </div>
              <button
                type="button"
                onClick={notifyUnderDevelopment}
                className="w-8 h-8 rounded-lg text-white flex items-center justify-center shrink-0 opacity-70 group-hover/feat:opacity-100 transition-opacity cursor-pointer"
                style={{ backgroundColor: store.accent }}
                aria-label={`Add ${product.name}`}
              >
                <Plus className="w-4 h-4" strokeWidth={2.5} />
              </button>
            </div>
          ))}
        </div>

        <h4 className="text-sm font-black text-brand-black uppercase tracking-widest mb-4">
          More from {store.shortName}
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          {rest.map((product) => (
            <ProductCard key={product.name} product={product} store={store} />
          ))}
        </div>
      </div>

      <div
        className="px-6 md:px-8 py-4 flex flex-wrap items-center justify-between gap-3 border-t border-brand-border"
        style={{ backgroundColor: store.tint }}
      >
        <div className="flex items-center gap-4 text-xs font-semibold text-brand-dark">
          <span className="inline-flex items-center gap-1.5">
            <Truck className="w-4 h-4" style={{ color: store.accent }} strokeWidth={2.25} />
            Free delivery over SAR 100
          </span>
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="w-4 h-4" style={{ color: store.accent }} strokeWidth={2.25} />
            Delivered across KSA
          </span>
        </div>
        <button
          type="button"
          onClick={notifyUnderDevelopment}
          className="text-xs font-black cursor-pointer hover:underline"
          style={{ color: store.accentDark }}
        >
          Browse full catalog →
        </button>
      </div>
    </motion.article>
  );
}

const Shop = () => {
  const [activeStore, setActiveStore] = useState("all");

  const visibleStores =
    activeStore === "all"
      ? partnerStores
      : partnerStores.filter((s) => s.id === activeStore);

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
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-10 mb-10">
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
              Browse curated products from Pinas Supermarket, Al Wafa Hypermarket, and
              Happy Ending General Store — order essentials with live delivery tracking.
            </p>
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

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="flex flex-wrap gap-2 mb-8 p-1.5 bg-white border border-brand-border rounded-2xl w-fit shadow-sm"
        >
          <button
            type="button"
            onClick={() => setActiveStore("all")}
            className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer ${
              activeStore === "all"
                ? "bg-brand-orange text-white shadow-md shadow-brand-orange/25"
                : "text-brand-grey hover:text-brand-dark hover:bg-brand-surface"
            }`}
          >
            All Stores
          </button>
          {partnerStores.map((store) => (
            <button
              key={store.id}
              type="button"
              onClick={() => setActiveStore(store.id)}
              className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer ${
                activeStore === store.id
                  ? "text-white shadow-md"
                  : "text-brand-grey hover:text-brand-dark hover:bg-brand-surface"
              }`}
              style={
                activeStore === store.id
                  ? {
                      backgroundColor: store.accent,
                      boxShadow: `0 4px 14px -4px ${store.accent}88`,
                    }
                  : undefined
              }
            >
              {store.shortName}
            </button>
          ))}
        </motion.div>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeStore}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35 }}
            className="space-y-8"
          >
            {visibleStores.map((store, index) => (
              <StorePanel key={store.id} store={store} index={index} />
            ))}
          </motion.div>
        </AnimatePresence>

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

            <button
              type="button"
              onClick={notifyUnderDevelopment}
              className="w-full md:w-auto shrink-0 bg-white hover:bg-brand-warm text-brand-orange font-black text-sm px-8 py-4 rounded-xl transition-all duration-300 transform hover:scale-[1.02] active:scale-95 shadow-xl cursor-pointer"
            >
              Explore Shop in App
            </button>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default Shop;
