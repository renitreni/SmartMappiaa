import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Star, Clock, Flame, ArrowRight, Sparkles, UtensilsCrossed } from "lucide-react";
import { api } from "../portal/lib/api";
import { fmtSAR } from "../portal/lib/constants";
import { restaurants as demoRestaurants } from "../data/restaurants";

const stats = [
  { value: "500+", label: "Partner restaurants" },
  { value: "4.8★", label: "Average rating" },
  { value: "15 min", label: "Avg. delivery" },
];

const cardVariants = {
  hidden: { opacity: 0, y: 40 },
  visible: (index) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: index * 0.12, ease: "easeOut" },
  }),
};

// Marketing badge slug -> label + card style. Slugs match the DB
// merchants_badge_chk constraint (migration 0015) and the demo data tags.
const BADGE_META = {
  top_rated: { label: "Top Rated", cls: "bg-brand-orange text-white" },
  popular: { label: "Popular", cls: "bg-white/95 text-brand-orange" },
  new: { label: "New", cls: "bg-green-500 text-white" },
  trending: { label: "Trending", cls: "bg-brand-red text-white" },
};
// The demo data uses human labels; map them to the same styles.
const demoTagStyles = {
  "Top Rated": "bg-brand-orange text-white",
  Popular: "bg-white/95 text-brand-orange",
  Trending: "bg-brand-red text-white",
  New: "bg-green-500 text-white",
};

// Normalize a LIVE (admin-managed) restaurant into the card shape.
function liveToCard(r, deliveryFee) {
  const b = r.badge ? BADGE_META[r.badge] : null;
  return {
    key: r.id,
    to: `/food/r/${r.id}`,
    name: r.name,
    cuisine: r.cuisine_type || "",
    image: r.logo_url || null,
    bg: "#FFFFFF",
    cover: false, // logos read better contained
    badgeLabel: b ? b.label : null,
    badgeCls: b ? b.cls : "",
    // Rating comes from REAL reviews only — hidden until they exist.
    rating: r.rating != null ? String(r.rating) : null,
    reviewsLabel: r.reviewCount > 0 ? `${r.reviewCount} reviews` : null,
    feeLabel: `${fmtSAR(deliveryFee)} delivery`,
  };
}

// Normalize a DEMO restaurant (fallback when the API has no data / is down).
function demoToCard(r) {
  return {
    key: `demo-${r.id}`,
    to: "/food", // demo cards aren't real menus — send to discovery
    name: r.name,
    cuisine: r.cuisine,
    image: r.image,
    bg: r.bg,
    cover: r.cover,
    badgeLabel: r.tag,
    badgeCls: demoTagStyles[r.tag] || "bg-white/95 text-brand-orange",
    rating: r.rating,
    reviewsLabel: `${r.reviews} reviews`,
    feeLabel: r.fee,
  };
}

function RestaurantCard({ card, index }) {
  return (
    <Link to={card.to} className="block">
      <motion.article
        custom={index}
        variants={cardVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-50px" }}
        className="group relative bg-white border border-brand-border rounded-3xl overflow-hidden cursor-pointer transition-all duration-300 hover:-translate-y-2 hover:border-brand-orange/30 hover:shadow-2xl hover:shadow-brand-orange/10"
      >
        <div className="relative h-52 sm:h-56 overflow-hidden" style={{ backgroundColor: card.bg }}>
          {card.image ? (
            <img
              src={card.image}
              alt={card.name}
              className={`absolute inset-0 w-full h-full transform group-hover:scale-110 transition-transform duration-500 ${
                card.cover ? "object-cover" : "object-contain p-5 sm:p-6"
              }`}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-brand-orange/15 to-brand-red/10">
              <UtensilsCrossed className="w-12 h-12 text-brand-orange/40" strokeWidth={1.5} />
            </div>
          )}
          {card.cover && (
            <div className="absolute inset-0 bg-linear-to-t from-black/60 via-black/15 to-transparent" />
          )}

          {card.badgeLabel && (
            <span
              className={`absolute top-4 left-4 text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-full shadow-md ${card.badgeCls}`}
            >
              {card.badgeLabel}
            </span>
          )}

          {card.rating && (
            <div className="absolute top-4 right-4 flex items-center gap-1 bg-white/95 backdrop-blur-sm text-brand-black text-xs font-black px-2.5 py-1.5 rounded-full shadow-md">
              <Star className="w-3.5 h-3.5 text-brand-orange fill-brand-orange" strokeWidth={0} />
              {card.rating}
            </div>
          )}

          <div className="absolute bottom-4 left-4 right-4 flex items-center justify-end">
            <span className="text-[10px] font-bold text-white/90 bg-black/30 backdrop-blur-sm px-2.5 py-1 rounded-full">
              {card.feeLabel}
            </span>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          <h3 className="text-lg font-black text-brand-black tracking-tight group-hover:text-brand-orange transition-colors leading-snug mb-2">
            {card.name}
          </h3>
          {card.cuisine && <p className="text-brand-grey text-sm font-medium mb-4">{card.cuisine}</p>}

          <div className="flex items-center justify-between pt-4 border-t border-brand-border">
            <span className="inline-flex items-center gap-1 text-xs text-brand-grey font-medium">
              {card.reviewsLabel ? (
                <>
                  <Flame className="w-3.5 h-3.5 text-brand-orange" strokeWidth={2.5} />
                  {card.reviewsLabel}
                </>
              ) : (
                <>
                  <Clock className="w-3.5 h-3.5 text-brand-orange" strokeWidth={2.5} />
                  Order now
                </>
              )}
            </span>
            <span className="inline-flex items-center gap-1.5 text-sm font-bold text-brand-orange opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300">
              Order Now
              <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
            </span>
          </div>
        </div>
      </motion.article>
    </Link>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white border border-brand-border rounded-3xl overflow-hidden animate-pulse">
      <div className="h-52 sm:h-56 bg-brand-surface" />
      <div className="p-5 sm:p-6 space-y-3">
        <div className="h-5 bg-brand-surface rounded w-2/3" />
        <div className="h-3 bg-brand-surface rounded w-1/3" />
        <div className="h-8 bg-brand-surface rounded w-full mt-4" />
      </div>
    </div>
  );
}

const Restaurants = () => {
  const [cards, setCards] = useState(null); // null = loading

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api.foodRestaurants(); // public, featured-first
        const live = data?.restaurants || [];
        if (!alive) return;
        if (live.length > 0) {
          setCards(live.slice(0, 8).map((r) => liveToCard(r, data.deliveryFee)));
        } else {
          // No listed restaurants yet — keep the section looking alive with
          // demo placeholders that route to the discovery page.
          setCards(demoRestaurants.map(demoToCard));
        }
      } catch {
        if (alive) setCards(demoRestaurants.map(demoToCard)); // API down -> never break the page
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section
      id="restaurants"
      className="relative w-full bg-brand-muted px-8 md:px-20 py-24 border-t border-brand-border overflow-hidden"
    >
      <div
        className="absolute top-0 right-0 w-[480px] h-[480px] bg-brand-orange/5 rounded-full blur-[120px] pointer-events-none"
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
              <Sparkles className="w-4 h-4" strokeWidth={2.5} />
              Premium Culinary Partners
            </span>

            <h2 className="text-3xl md:text-5xl font-black tracking-tight text-brand-black mt-3 leading-tight">
              KSA's Most Loved Flavors.{" "}
              <span className="text-transparent bg-clip-text bg-linear-to-r from-brand-orange to-brand-red">
                Handpicked For You.
              </span>
            </h2>

            <p className="text-brand-grey text-sm md:text-base mt-4 font-medium leading-relaxed">
              Discover top-rated restaurants with blazing-fast delivery, live
              tracking, and exclusive deals — all in one tap.
            </p>

            <Link
              to="/food"
              className="inline-flex items-center gap-2 mt-5 text-sm font-bold text-brand-orange hover:gap-3 transition-all"
            >
              See all restaurants
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
                <p className="text-2xl md:text-3xl font-black text-brand-black">{stat.value}</p>
                <p className="text-brand-grey text-xs font-semibold uppercase tracking-wider mt-0.5">
                  {stat.label}
                </p>
              </div>
            ))}
          </motion.div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 lg:gap-7">
          {cards === null
            ? [...Array(8)].map((_, i) => <SkeletonCard key={i} />)
            : cards.map((card, index) => <RestaurantCard key={card.key} card={card} index={index} />)}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mt-16 relative overflow-hidden rounded-3xl"
        >
          <div className="absolute inset-0 bg-linear-to-r from-brand-orange to-brand-red" />
          <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_top_right,white,transparent_60%)]" />

          <div className="relative z-10 p-8 md:p-12 flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="max-w-xl text-center md:text-left">
              <span className="inline-block text-white/80 text-xs font-bold uppercase tracking-widest mb-3">
                Order in seconds
              </span>
              <h3 className="text-2xl md:text-3xl font-black text-white mb-3 tracking-tight">
                Craving something delicious right now?
              </h3>
              <p className="text-white/85 text-sm md:text-base font-medium leading-relaxed">
                Browse live menus, track your rider on the map, and pay in a tap —
                all on SmartMappia.
              </p>
            </div>

            <Link
              to="/food"
              className="w-full md:w-auto shrink-0 bg-white hover:bg-brand-warm text-brand-orange font-black text-sm px-8 py-4 rounded-xl transition-all duration-300 transform hover:scale-[1.02] active:scale-95 shadow-xl cursor-pointer text-center"
            >
              Browse Restaurants
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default Restaurants;
