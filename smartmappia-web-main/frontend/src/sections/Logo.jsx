import React from 'react';
import { motion } from 'framer-motion';

const partners = [
  { id: 1, name: "Al Baik", logo: "logo1.jpg" },
  { id: 2, name: "Herfy", logo: "logo2.jpg" },
  { id: 3, name: "Kudu", logo: "logo3.png" },
  { id: 4, name: "Maestro Pizza", logo: "logo4.jpg" },
  { id: 5, name: "Shawarma House", logo: "logo5.png" },
  { id: 6, name: "Pizza Hut", logo: "logo6.jpg" },
  { id: 7, name: "Starbucks", logo: "logo7.png" },
  { id: 8, name: "Tianlala", logo: "brands/tianlala.png" },
  { id: 9, name: "Ka Inasal", logo: "brands/ka-inasal.png" },
  { id: 10, name: "Al Wafa", logo: "brands/al-wafa.png" },
  { id: 11, name: "Happy Ending", logo: "brands/happy-ending.png" },
];

const PartnerCard = ({ partner }) => (
  <div className="group relative shrink-0 mx-5 sm:mx-7 md:mx-8 z-0 hover:z-20 transition-[transform,z-index] duration-300">
    <div className="w-36 h-36 sm:w-40 sm:h-40 md:w-44 md:h-44 lg:w-48 lg:h-48 flex items-center justify-center bg-white border border-brand-border rounded-3xl p-6 sm:p-7 transition-all duration-300 ease-out group-hover:scale-110 group-hover:shadow-xl group-hover:shadow-brand-orange/15 group-hover:border-brand-orange/30">
      <img
        src={`/${partner.logo}`}
        alt={`${partner.name} logo`}
        className="max-h-full max-w-full object-contain"
      />
    </div>
  </div>
);

const LogoGrid = () => {
  const marqueeItems = [...partners, ...partners];

  return (
    <div className="mt-24 max-w-7xl mx-auto">
      <div className="relative flex items-center justify-center mb-12">
        <div className="absolute inset-x-0 h-px bg-linear-to-r from-transparent via-brand-border to-transparent" />
        <span className="relative bg-brand-muted px-5 text-brand-orange text-sm font-bold tracking-widest uppercase">
          Featured Restaurant Partners
        </span>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="relative"
      >
        <div className="absolute left-0 top-0 bottom-0 w-16 sm:w-24 bg-linear-to-r from-brand-muted to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-16 sm:w-24 bg-linear-to-l from-brand-muted to-transparent z-10 pointer-events-none" />

        <div className="overflow-hidden py-10 sm:py-12">
          <div className="partner-marquee-track flex w-max items-center">
            {marqueeItems.map((partner, index) => (
              <PartnerCard key={`${partner.id}-${index}`} partner={partner} />
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default LogoGrid;
