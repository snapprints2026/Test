import { useState } from "react";
import { MotionConfig } from "framer-motion";
import Navbar from "../components/landing/Navbar";
import Hero from "../components/landing/Hero";
import TrustedBy from "../components/landing/TrustedBy";
import HowItWorks from "../components/landing/HowItWorks";
import Features from "../components/landing/Features";
import Segments from "../components/landing/Segments";
import MachineShowcase from "../components/landing/MachineShowcase";
import Contact from "../components/landing/Contact";
import Footer from "../components/landing/Footer";
import DemoModal from "../components/landing/DemoModal";

export default function HomePage() {
  const [isDemoOpen, setIsDemoOpen] = useState(false);
  const openDemo = () => setIsDemoOpen(true);

  return (
    // reducedMotion="user": skips the slide/fade animations for visitors who
    // have turned animations off in their phone or computer settings.
    <MotionConfig reducedMotion="user">
      <div className="bg-white">
        <Navbar onDemoClick={openDemo} />
        <Hero onDemoClick={openDemo} />
        <TrustedBy />
        <HowItWorks />
        <Features />
        <Segments />
        <MachineShowcase />
        <Contact onDemoClick={openDemo} />
        <Footer />
        <DemoModal open={isDemoOpen} onClose={() => setIsDemoOpen(false)} />
      </div>
    </MotionConfig>
  );
}
