import { CheckCircle, Smartphone, ShieldCheck, Wifi, CreditCard, Printer } from "lucide-react";
import { motion } from "framer-motion";
import Reveal from "./Reveal";

export default function MachineShowcase() {
  return (
    <section className="bg-gradient-to-b from-white to-brand-50 py-16 sm:py-28 text-brand-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-12 sm:gap-20 items-center">
        {/* Machine Image */}
        <motion.div
          initial={{ opacity: 0, x: -40 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.7 }}
          className="relative flex justify-center"
        >
          <div className="absolute w-64 h-64 sm:w-96 sm:h-96 rounded-full bg-brand-200/30 blur-[100px] sm:blur-[120px]" />
          <img
            src="/images/SnapPrints-hero-machine.png"
            alt="SnapPrints Machine"
            className="relative w-52 sm:w-72 md:w-96 lg:w-[420px] h-auto rounded-3xl drop-shadow-[0_0_40px_rgba(19,107,255,0.2)] animate-float"
          />
        </motion.div>

        {/* Content */}
        <motion.div
          initial={{ opacity: 0, x: 40 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="text-center lg:text-left"
        >
          <p className="text-brand-500 uppercase tracking-[0.35em] font-semibold text-xs sm:text-sm">Smart Printing Kiosk</p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mt-4 sm:mt-5 leading-tight text-brand-900">
            Built for the
            <span className="text-brand-500"> Future of Printing</span>
          </h2>
          <p className="mt-6 sm:mt-8 text-slate-500 text-base sm:text-lg leading-7 sm:leading-8">
            SnapPrints is an intelligent self-service printing kiosk that enables users to upload documents, pay
            digitally and print instantly without any human assistance.
          </p>

          {/* Features */}
          <div className="grid grid-cols-2 gap-4 sm:gap-5 mt-8 sm:mt-10 text-left">
            <div className="flex items-center gap-2 sm:gap-3">
              <CheckCircle className="text-brand-500 shrink-0" size={18} />
              <span className="text-sm sm:text-base text-brand-900">QR Code Printing</span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <Smartphone className="text-brand-500 shrink-0" size={18} />
              <span className="text-sm sm:text-base text-brand-900">Mobile Upload</span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <CreditCard className="text-brand-500 shrink-0" size={18} />
              <span className="text-sm sm:text-base text-brand-900">UPI Payments</span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <Printer className="text-brand-500 shrink-0" size={18} />
              <span className="text-sm sm:text-base text-brand-900">Instant Printing</span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <ShieldCheck className="text-brand-500 shrink-0" size={18} />
              <span className="text-sm sm:text-base text-brand-900">Secure Documents</span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <Wifi className="text-brand-500 shrink-0" size={18} />
              <span className="text-sm sm:text-base text-brand-900">Cloud Connected</span>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 sm:gap-5 mt-10 sm:mt-14">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 text-center">
              <h3 className="text-xl sm:text-3xl font-bold text-brand-500">24×7</h3>
              <p className="text-slate-500 mt-1 sm:mt-2 text-xs sm:text-sm">Available</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 text-center">
              <h3 className="text-xl sm:text-3xl font-bold text-brand-500">100%</h3>
              <p className="text-slate-500 mt-1 sm:mt-2 text-xs sm:text-sm">Contactless</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 text-center">
              <h3 className="text-xl sm:text-3xl font-bold text-brand-500">UPI</h3>
              <p className="text-slate-500 mt-1 sm:mt-2 text-xs sm:text-sm">Enabled</p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
