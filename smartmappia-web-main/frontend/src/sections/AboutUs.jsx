import React from 'react';
import { motion } from 'framer-motion';

const AboutUs = () => {
  return (
    <section id="about" className="py-24 px-8 md:px-20 bg-white text-brand-dark border-t border-brand-border">
        <div className="max-w-6xl mx-auto">
            <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-16 text-center"
            >
            <h3 className="text-brand-orange text-sm font-bold tracking-widest uppercase mb-3">About Us</h3>
            <h2 className="text-3xl md:text-5xl font-black text-brand-black">Who We Are</h2>
        </motion.div>

      <div className="grid md:grid-cols-2 gap-16 items-center">
        <motion.div 
          initial={{ opacity: 0, x: -50 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
        >
          <h2 className="text-4xl md:text-5xl font-black mb-6 text-brand-black">Empowering the <span className="text-brand-orange">Kingdom of Saudi Arabia's</span> Daily Rhythm.</h2>
          <p className="text-brand-grey text-lg leading-relaxed">
            SmartMappia was built on a simple vision: to bridge the gap between busy urban life and seamless service accessibility. We are more than just an app; we are your digital partner in food, delivery, and transport.
          </p>
        </motion.div>
        
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="border border-brand-orange/20 p-8 rounded-3xl bg-brand-warm"
        >
          <div className="text-brand-orange font-bold text-sm uppercase tracking-widest mb-4">Our Mission</div>
          <p className="italic text-xl text-brand-dark">"To make every transaction in the Kingdom of Saudi Arabia effortless, secure, and instant for everyone."</p>
        </motion.div>
        
        </div>
      </div>
    </section>
  );
};

export default AboutUs;
