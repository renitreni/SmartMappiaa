import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Clock,
  Gift,
  Plus,
  Search,
  ShoppingBag,
  Sparkles,
  Star,
  Tag,
} from "lucide-react";
import { notifyUnderDevelopment } from "../portal/lib/notify";

const categories = [
  { id: "all", label: "All" },
  { id: "electronics", label: "Electronics" },
  { id: "groceries", label: "Groceries" },
  { id: "fashion", label: "Fashion" },
  { id: "pharmacy", label: "Pharmacy" },
  { id: "beauty", label: "Beauty" },
  { id: "gifts", label: "Gifts" },
];

const products = [
  {
    id: 1,
    name: "Sony Premium Headphones",
    category: "electronics",
    price: 1299,
    originalPrice: 1499,
    rating: 4.9,
    delivery: "30–45 min",
    tag: "Best Seller",
    image:
      "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?q=80&w=600&auto=format&fit=crop",
  },
  {
    id: 2,
    name: "Wireless Earbuds Pro",
    category: "electronics",
    price: 149,
    rating: 4.7,
    delivery: "25–40 min",
    tag: "Trending",
    image:
      "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?q=80&w=600&auto=format&fit=crop",
  },
  {
    id: 3,
    name: "Smart Watch Series",
    category: "electronics",
    price: 299,
    rating: 4.8,
    delivery: "30–45 min",
    tag: "New",
    image:
      "https://images.unsplash.com/photo-1523275335684-37898b6baf30?q=80&w=600&auto=format&fit=crop",
  },
  {
    id: 4,
    name: "Performance Running Shoes",
    category: "fashion",
    price: 189,
    rating: 4.6,
    delivery: "35–50 min",
    image:
      "https://images.unsplash.com/photo-1542291026-7eec264c27ff?q=80&w=600&auto=format&fit=crop",
  },
  {
    id: 5,
    name: "Urban Travel Backpack",
    category: "fashion",
    price: 79,
    rating: 4.5,
    delivery: "25–40 min",
    image:
      "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?q=80&w=600&auto=format&fit=crop",
  },
  {
    id: 6,
    name: "Fresh Essentials Box",
    category: "groceries",
    price: 45,
    rating: 4.8,
    delivery: "15–25 min",
    tag: "Fast Delivery",
    image:
      "https://images.unsplash.com/photo-1542838132-92c53300491e?q=80&w=600&auto=format&fit=crop",
  },
  {
    id: 7,
    name: "Luxury Skincare Set",
    category: "beauty",
    price: 120,
    originalPrice: 160,
    rating: 4.7,
    delivery: "30–45 min",
    tag: "Sale",
    image:
      "https://images.unsplash.com/photo-1556228578-0d85b1a4d571?q=80&w=600&auto=format&fit=crop",
  },
  {
    id: 8,
    name: "Premium Gift Hamper",
    category: "gifts",
    price: 99,
    rating: 4.9,
    delivery: "40–55 min",
    image:
      "https://images.unsplash.com/photo-1513885535751-8b9238bd345a?q=80&w=600&auto=format&fit=crop",
  },
];

const stats = [
  { value: "10k+", label: "Products" },
  { value: "45 min", label: "Avg. delivery" },
  { value: "6", label: "Categories" },
];

const tagStyles = {
  "Best Seller": "bg-brand-orange text-white",
  Trending: "bg-brand-red text-white",
  New: "bg-green-500 text-white",
  Sale: "bg-brand-red text-white",
  "Fast Delivery": "bg-brand-dark text-white",
};

const cardVariants = {
  hidden: { opacity: 0, y: 32 },
  visible: (index) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.45,
      delay: index * 0.08,
      ease: "easeOut",
    },
  }),
};

const formatPrice = (value) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 0 });

const Shop = () => {
  const [activeCategory, setActiveCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return products.filter((product) => {
      const matchesCategory =
        activeCategory === "all" || product.category === activeCategory;
      const matchesSearch =
        !query ||
        product.name.toLowerCase().includes(query) ||
        product.category.toLowerCase().includes(query);

      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, searchQuery]);

  return (
    <section
      id="shop"
      className="relative w-full bg-white px-8 md:px-20 py-24 border-t border-brand-border overflow-hidden"
    >
      <div
        className="absolute top-0 left-0 w-[480px] h-[480px] bg-brand-orange/5 rounded-full blur-[120px] pointer-events-none"
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
              Shop anything.{" "}
              <span className="text-transparent bg-clip-text bg-linear-to-r from-brand-orange to-brand-red">
                Delivered in minutes.
              </span>
            </h2>

            <p className="text-brand-grey text-sm md:text-base mt-4 font-medium leading-relaxed">
              Browse thousands of products from top local and international brands —
              tech, fashion, groceries, and more, all with live GPS tracking to your
              door.
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
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.05 }}
          className="mb-8 space-y-4"
        >
          <div className="relative max-w-xl">
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-brand-grey pointer-events-none"
              strokeWidth={2}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search products..."
              className="w-full pl-12 pr-4 py-3.5 rounded-2xl bg-white border border-brand-border text-brand-dark text-sm placeholder:text-brand-grey focus:outline-none focus:border-brand-orange/50 focus:ring-2 focus:ring-brand-orange/10 transition-all"
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-all duration-200 cursor-pointer ${
                  activeCategory === cat.id
                    ? "bg-linear-to-r from-brand-orange to-brand-red text-white shadow-md shadow-brand-orange/25"
                    : "bg-white border border-brand-border text-brand-grey hover:text-brand-orange hover:border-brand-orange/30 hover:bg-brand-warm"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </motion.div>

        {filteredProducts.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6">
            {filteredProducts.map((product, index) => (
              <motion.article
                key={product.id}
                custom={index}
                variants={cardVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-40px" }}
                className="group relative bg-white border border-brand-border rounded-3xl overflow-hidden cursor-pointer transition-all duration-300 hover:-translate-y-1.5 hover:border-brand-orange/30 hover:shadow-xl hover:shadow-brand-orange/10"
              >
                <div className="relative aspect-square overflow-hidden bg-brand-surface">
                  <img
                    src={product.image}
                    alt={product.name}
                    className="w-full h-full object-cover transform group-hover:scale-110 transition-transform duration-700"
                  />
                  <div className="absolute inset-0 bg-linear-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                  {product.tag && (
                    <span
                      className={`absolute top-3 left-3 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full shadow-md ${
                        tagStyles[product.tag] ?? "bg-white/95 text-brand-orange"
                      }`}
                    >
                      {product.tag}
                    </span>
                  )}

                  <div className="absolute top-3 right-3 flex items-center gap-1 bg-white/95 backdrop-blur-sm text-brand-black text-[10px] font-black px-2 py-1 rounded-full shadow-sm">
                    <Star
                      className="w-3 h-3 text-brand-orange fill-brand-orange"
                      strokeWidth={0}
                    />
                    {product.rating}
                  </div>

                  <button
                    aria-label={`Add ${product.name} to cart`}
                    className="absolute bottom-3 right-3 w-9 h-9 rounded-xl bg-brand-orange text-white flex items-center justify-center shadow-lg shadow-brand-orange/30 opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300 hover:bg-brand-red cursor-pointer"
                  >
                    <Plus className="w-4 h-4" strokeWidth={2.5} />
                  </button>
                </div>

                <div className="p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-brand-grey mb-1">
                    {product.category}
                  </p>
                  <h3 className="text-sm md:text-base font-black text-brand-black tracking-tight leading-snug line-clamp-2 group-hover:text-brand-orange transition-colors min-h-10">
                    {product.name}
                  </h3>

                  <div className="flex items-end gap-2 mt-2">
                    <p className="text-base md:text-lg font-black text-brand-orange">
                      SAR {formatPrice(product.price)}
                    </p>
                    {product.originalPrice && (
                      <p className="text-xs text-brand-grey line-through mb-0.5">
                        SAR {formatPrice(product.originalPrice)}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-brand-border">
                    <span className="inline-flex items-center gap-1 text-[10px] md:text-xs text-brand-grey font-medium">
                      <Clock className="w-3 h-3 text-brand-orange" strokeWidth={2.5} />
                      {product.delivery}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-brand-orange opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      View
                      <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.5} />
                    </span>
                  </div>
                </div>
              </motion.article>
            ))}
          </div>
        ) : (
          <div className="text-center py-16 px-6 bg-white rounded-3xl border border-brand-border">
            <Tag className="w-10 h-10 text-brand-grey/40 mx-auto mb-3" strokeWidth={1.5} />
            <p className="text-brand-black font-bold">No products found</p>
            <p className="text-brand-grey text-sm mt-1">
              Try a different category or search term.
            </p>
          </div>
        )}

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
