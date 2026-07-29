import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Star, Clock, Flame, ArrowRight, Sparkles } from "lucide-react";
import { api } from "../portal/lib/api";
import { notifyMenuUnavailable } from "../portal/lib/notify";
import { restaurants as restaurantData } from "../data/restaurants";

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

const tagStyles = {
  "Top Rated": "bg-brand-orange text-white",
  Popular: "bg-white/95 text-brand-orange",
  Trending: "bg-brand-red text-white",
  New: "bg-green-500 text-white",
};

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

// Match a marketing partner to a live merchant so "Order now" opens the real menu.
function findLiveMatch(demoName, liveList) {
  const demoKey = normalizeName(demoName);
  if (!demoKey) return null;
  return (
    liveList.find((r) => {
      const liveKey = normalizeName(r.name);
      return liveKey === demoKey || liveKey.includes(demoKey) || demoKey.includes(liveKey);
    }) || null
  );
}

function RestaurantCard({ resto, index, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(resto)} className="block w-full text-left cursor-pointer">
      <motion.article
        custom={index}
        variants={cardVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-50px" }}
        className="group relative bg-white border border-brand-border rounded-3xl overflow-hidden transition-all duration-300 hover:-translate-y-2 hover:border-brand-orange/30 hover:shadow-2xl hover:shadow-brand-orange/10"
      >
        <div
          className="relative h-52 sm:h-56 overflow-hidden"
          style={{ backgroundColor: resto.bg }}
        >
          <img
            src={resto.image}
            alt={resto.name}
            className={`absolute inset-0 w-full h-full transform group-hover:scale-110 transition-transform duration-500 ${
              resto.cover ? "object-cover" : "object-contain p-5 sm:p-6"
            }`}
          />
          {resto.cover && (
            <div className="absolute inset-0 bg-linear-to-t from-black/60 via-black/15 to-transparent" />
          )}

          <span
            className={`absolute top-4 left-4 text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-full shadow-md ${tagStyles[resto.tag]}`}
          >
            {resto.tag}
          </span>

          <div className="absolute top-4 right-4 flex items-center gap-1 bg-white/95 backdrop-blur-sm text-brand-black text-xs font-black px-2.5 py-1.5 rounded-full shadow-md">
            <Star className="w-3.5 h-3.5 text-brand-orange fill-brand-orange" strokeWidth={0} />
            {resto.rating}
          </div>

          <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 bg-white/95 backdrop-blur-sm text-brand-dark text-xs font-bold px-3 py-1.5 rounded-full shadow-sm">
              <Clock className="w-3.5 h-3.5 text-brand-orange" strokeWidth={2.5} />
              {resto.time}
            </span>
            <span className="text-[10px] font-bold text-white/90 bg-black/30 backdrop-blur-sm px-2.5 py-1 rounded-full">
              {resto.fee}
            </span>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          <h3 className="text-lg font-black text-brand-black tracking-tight group-hover:text-brand-orange transition-colors leading-snug mb-2">
            {resto.name}
          </h3>
          <p className="text-brand-grey text-sm font-medium mb-4">{resto.cuisine}</p>

          <div className="flex items-center justify-between pt-4 border-t border-brand-border">
            <span className="inline-flex items-center gap-1 text-xs text-brand-grey font-medium">
              <Flame className="w-3.5 h-3.5 text-brand-orange" strokeWidth={2.5} />
              {resto.reviews} reviews
            </span>
            <span className="inline-flex items-center gap-1.5 text-sm font-bold text-brand-orange opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300">
              Order Now
              <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
            </span>
          </div>
        </div>
      </motion.article>
    </button>
  );
}

const Restaurants = () => {
  const navigate = useNavigate();
  // Live merchant keyed by marketing card id: { id, hasMenu }
  const [liveByCardId, setLiveByCardId] = useState({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api.foodRestaurants();
        const live = data?.restaurants || [];
        if (!alive || !live.length) return;
        const map = {};
        for (const resto of restaurantData) {
          const match = findLiveMatch(resto.name, live);
          if (match) {
            map[resto.id] = { id: match.id, hasMenu: match.hasMenu !== false };
          }
        }
        setLiveByCardId(map);
      } catch {
        // Marketing grid still works without the API.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  function openRestaurant(resto) {
    const live = liveByCardId[resto.id];
    if (live?.id && live.hasMenu) {
      navigate(`/food/r/${live.id}`);
      return;
    }
    notifyMenuUnavailable(resto.name);
  }

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
          {restaurantData.map((resto, index) => (
            <RestaurantCard
              key={resto.id}
              resto={resto}
              index={index}
              onOpen={openRestaurant}
            />
          ))}
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
