import React from "react";
import Navbar from "./components/Navbar";
import Hero from "./sections/Hero";
import AboutUs from "./sections/AboutUs";
import Services from "./sections/Services";
import VideoShowcase from "./sections/VideoShowcase";
import PromoBanners from "./sections/PromoBanners";
import HowItWorks from "./sections/HowItWorks";
import Restaurants from "./sections/Restaurants";
import SponsoredReel from "./sections/SponsoredReel";
import Shop from "./sections/Shop";
import PickDrop from "./sections/PickDrop";
import FAQ from "./sections/FAQ";
import Footer from "./sections/Footer";

function App() {
  return (
    <div className="min-h-screen bg-brand-light text-brand-dark pt-20">
      <Navbar />

      <main>
        <Hero />
        <AboutUs />
        <Services />
        <PromoBanners />
        <VideoShowcase />
        <HowItWorks />
        <Restaurants />
        <SponsoredReel />
        <Shop />
        <PickDrop />
        <FAQ />
        <Footer />
      </main>
    </div>
  );
}

export default App;
