import React from "react";
import { motion } from "framer-motion";
import { Star, Clock, Flame, ArrowRight, Sparkles } from "lucide-react";
import { notifyUnderDevelopment } from "../portal/lib/notify";

const restaurantData = [
  {
    id: 1,
    name: "Al Baik Express",
    cuisine: "Broasted Chicken",
    rating: "4.9",
    reviews: "2.4k",
    time: "12-15 min",
    fee: "Free delivery",
    tag: "Top Rated",
    image:
      "https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?q=80&w=600&auto=format&fit=crop",
  },
  {
    id: 2,
    name: "Shawarma Cartel",
    cuisine: "Middle Eastern",
    rating: "4.7",
    reviews: "1.8k",
    time: "10-20 min",
    fee: "SAR 5 delivery",
    tag: "Popular",
    image:
      "https://images.unsplash.com/photo-1528736235302-52922df5c122?q=80&w=600&auto=format&fit=crop",
  },
  {
    id: 3,
    name: "Burger Boutique",
    cuisine: "American Gourmet",
    rating: "4.8",
    reviews: "960",
    time: "20-30 min",
    fee: "Free delivery",
    tag: "Trending",
    image:
      "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?q=80&w=600&auto=format&fit=crop",
  },
  {
    id: 4,
    name: "Matcha & Co.",
    cuisine: "Dessert & Cafe",
    rating: "4.6",
    reviews: "720",
    time: "10-15 min",
    fee: "SAR 3 delivery",
    tag: "New",
    image:
      "https://images.unsplash.com/photo-1559925393-8be0ec4767c8?q=80&w=600&auto=format&fit=crop",
  },
];

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
    transition: {
      duration: 0.5,
      delay: index * 0.12,
      ease: "easeOut",
    },
  }),
};

const tagStyles = {
  "Top Rated": "bg-brand-orange text-white",
  Popular: "bg-white/95 text-brand-orange",
  Trending: "bg-brand-red text-white",
  New: "bg-green-500 text-white",
};

const Restaurants = () => {
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
              Riyadh's Most Loved Flavors.{" "}
              <span className="text-transparent bg-clip-text bg-linear-to-r from-brand-orange to-brand-red">
                Handpicked For You.
              </span>
            </h2>

            <p className="text-brand-grey text-sm md:text-base mt-4 font-medium leading-relaxed">
              Discover top-rated restaurants with blazing-fast delivery, live
              tracking, and exclusive deals — all in one tap.
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

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 lg:gap-7">
          {restaurantData.map((resto, index) => (
            <motion.article
              key={resto.id}
              custom={index}
              variants={cardVariants}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-50px" }}
              className="group relative bg-white border border-brand-border rounded-3xl overflow-hidden cursor-pointer transition-all duration-300 hover:-translate-y-2 hover:border-brand-orange/30 hover:shadow-2xl hover:shadow-brand-orange/10"
            >
              <div className="relative h-52 sm:h-56 overflow-hidden">
                <img
                  src={resto.image}
                  alt={resto.name}
                  className="w-full h-full object-cover transform group-hover:scale-110 transition-transform duration-700"
                />
                <div className="absolute inset-0 bg-linear-to-t from-black/50 via-black/10 to-transparent opacity-80 group-hover:opacity-90 transition-opacity duration-300" />

                <span
                  className={`absolute top-4 left-4 text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-full shadow-md ${tagStyles[resto.tag]}`}
                >
                  {resto.tag}
                </span>

                <div className="absolute top-4 right-4 flex items-center gap-1 bg-white/95 backdrop-blur-sm text-brand-black text-xs font-black px-2.5 py-1.5 rounded-full shadow-md">
                  <Star
                    className="w-3.5 h-3.5 text-brand-orange fill-brand-orange"
                    strokeWidth={0}
                  />
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
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h3 className="text-lg font-black text-brand-black tracking-tight group-hover:text-brand-orange transition-colors leading-snug">
                    {resto.name}
                  </h3>
                </div>

                <p className="text-brand-grey text-sm font-medium mb-4">
                  {resto.cuisine}
                </p>

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
                Available on mobile
              </span>
              <h3 className="text-2xl md:text-3xl font-black text-white mb-3 tracking-tight">
                Craving something delicious right now?
              </h3>
              <p className="text-white/85 text-sm md:text-base font-medium leading-relaxed">
                Download SmartMappia to unlock exclusive restaurant deals,
                one-tap reordering, and live GPS tracking straight to your door.
              </p>
            </div>

            <button
              type="button"
              onClick={notifyUnderDevelopment}
              className="w-full md:w-auto shrink-0 bg-white hover:bg-brand-warm text-brand-orange font-black text-sm px-8 py-4 rounded-xl transition-all duration-300 transform hover:scale-[1.02] active:scale-95 shadow-xl cursor-pointer"
            >
              Download App Now
            </button>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default Restaurants;
