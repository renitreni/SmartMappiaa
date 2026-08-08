import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { UtensilsCrossed, ShoppingBag, PlaneTakeoff, ArrowRight } from "lucide-react";
import Navbar from "../components/Navbar";
import Footer from "../sections/Footer";
import LogoGrid from "../sections/Logo";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";

const services = [
  {
    Icon: UtensilsCrossed,
    title: "Food Delivery",
    desc: "Order from hundreds of local restaurants and fast food favorites, with live tracking from kitchen to your door.",
    highlights: ["500+ partner restaurants", "Real-time tracking", "15 min avg. delivery"],
    to: "/services/food",
    accent: "from-brand-orange to-brand-red",
  },
  {
    Icon: ShoppingBag,
    title: "E-Commerce Shop",
    desc: "Browse trending products, daily essentials, and tech gadgets from trusted partner stores, with doorstep delivery.",
    highlights: ["Curated partner stores", "Essentials to gadgets", "Secure checkout"],
    to: "/services/shop",
    accent: "from-orange-400 to-brand-orange",
  },
  {
    Icon: PlaneTakeoff,
    title: "Pick & Drop",
    desc: "Door-to-terminal airport transfers across Riyadh. See your fare instantly and book with confidence.",
    highlights: ["Fixed rates, no hidden fees", "24/7 app access", "Live driver tracking"],
    to: "/services/pick-drop",
    accent: "from-brand-red to-orange-500",
  },
];

const cardVariants = {
  hidden: { opacity: 0, y: 40 },
  visible: (index) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: index * 0.12, ease: "easeOut" },
  }),
};

function ServiceCard({ Icon, title, desc, highlights, to, accent, index }) {
  return (
    <motion.div
      custom={index}
      variants={cardVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-50px" }}
    >
      <Card className="h-full transition-all duration-300 hover:-translate-y-1.5 hover:shadow-xl hover:shadow-brand-orange/10">
        <CardContent className="flex h-full flex-col px-8">
          <div
            className={`w-16 h-16 rounded-2xl bg-linear-to-br ${accent} flex items-center justify-center shadow-lg shadow-brand-orange/20`}
          >
            <Icon className="w-8 h-8 text-white" strokeWidth={2} />
          </div>

          <h2 className="text-xl font-black text-brand-black mt-6 tracking-tight">{title}</h2>
          <p className="text-brand-grey text-sm leading-relaxed mt-3 flex-1">{desc}</p>

          <ul className="mt-5 flex flex-wrap gap-2">
            {highlights.map((item) => (
              <li
                key={item}
                className="text-xs font-semibold text-brand-dark bg-brand-muted border border-brand-border rounded-full px-3 py-1.5"
              >
                {item}
              </li>
            ))}
          </ul>

          <Button asChild size="lg" className="mt-6 w-full">
            <Link to={to}>
              Explore
              <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}

const ServicesPage = () => {
  return (
    <div className="min-h-screen bg-brand-light text-brand-dark pt-20">
      <Navbar />

      <main>
        <section className="w-full px-6 md:px-16 lg:px-20 pt-16 pb-4 max-w-7xl mx-auto text-center md:text-left">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <span className="text-brand-orange text-sm font-bold tracking-widest uppercase">
              Our Services
            </span>
            <h1 className="text-4xl md:text-6xl font-black tracking-tight text-brand-black mt-3 leading-tight">
              One app. <span className="text-brand-orange">Every service you need.</span>
            </h1>
            <p className="text-brand-grey text-base md:text-lg mt-4 max-w-2xl mx-auto md:mx-0">
              Food delivery, shopping, and airport transfers — pick a service to see what's inside.
            </p>
          </motion.div>
        </section>

        <section className="w-full px-6 md:px-16 lg:px-20 py-12 max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
            {services.map((service, index) => (
              <ServiceCard key={service.title} {...service} index={index} />
            ))}
          </div>
        </section>

        <section className="w-full bg-brand-muted px-8 md:px-20 pb-24 border-t border-brand-border">
          <LogoGrid />
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default ServicesPage;
