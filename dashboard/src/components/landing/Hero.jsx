import { motion } from "framer-motion";

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12 } },
};
const item = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.21, 0.47, 0.32, 0.98] } },
};

export default function Hero({ onDemoClick }) {
  return (
    <section className="relative min-h-screen bg-brand-50 text-brand-900 overflow-hidden">
      <div className="absolute top-0 left-0 w-72 h-72 sm:w-96 sm:h-96 bg-brand-300/25 rounded-full blur-[100px] sm:blur-[120px]" />
      <div className="absolute bottom-0 right-0 w-80 h-80 sm:w-[500px] sm:h-[500px] bg-brand-200/25 rounded-full blur-[120px] sm:blur-[150px]" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-24 pb-16 sm:py-24 grid lg:grid-cols-2 gap-10 sm:gap-16 items-center">
        {/* Left Content */}
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="text-center lg:text-left"
        >
          <motion.span
            variants={item}
            className="inline-block bg-brand-100 border border-brand-200 text-brand-700 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-semibold uppercase tracking-wider"
          >
            India&apos;s Smart Self-Service Printing Machine
          </motion.span>

          <motion.h1
            variants={item}
            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold mt-6 sm:mt-8 leading-tight text-brand-900"
          >
            Print
            <span className="bg-gradient-to-r from-brand-500 via-brand-400 to-brand-600 bg-clip-text text-transparent animate-gradient-x"> Smarter</span>
            <br />
            Anytime.
            <br />
            Anywhere.
          </motion.h1>

          <motion.p
            variants={item}
            className="mt-6 sm:mt-8 text-base sm:text-lg text-slate-600 leading-7 sm:leading-8 max-w-xl mx-auto lg:mx-0"
          >
            Upload documents from your phone, pay securely using UPI, and collect your prints instantly from the
            SnapPrints kiosk.
          </motion.p>

          <motion.div
            variants={item}
            className="mt-8 sm:mt-10 flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 justify-center lg:justify-start"
          >
            <motion.button
              whileHover={{ scale: 1.04, y: -2 }}
              whileTap={{ scale: 0.97 }}
              onClick={onDemoClick}
              className="bg-brand-500 hover:bg-brand-600 transition-colors px-6 sm:px-8 py-3.5 sm:py-4 rounded-xl font-semibold text-white shadow-lg shadow-brand-500/30"
            >
              Request Demo
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.04, y: -2 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => document.getElementById("how")?.scrollIntoView({ behavior: "smooth" })}
              className="border border-slate-300 hover:border-brand-400 hover:text-brand-600 transition-colors px-6 sm:px-8 py-3.5 sm:py-4 rounded-xl font-semibold text-brand-900"
            >
              Learn More
            </motion.button>
          </motion.div>

          {/* Stats */}
          <motion.div variants={item} className="mt-10 sm:mt-14 grid grid-cols-3 gap-3 sm:gap-8">
            <div>
              <h3 className="text-xl sm:text-3xl font-bold text-brand-500">24×7</h3>
              <p className="text-slate-500 mt-1 sm:mt-2 text-xs sm:text-base">Available</p>
            </div>
            <div>
              <h3 className="text-xl sm:text-3xl font-bold text-brand-500">100%</h3>
              <p className="text-slate-500 mt-1 sm:mt-2 text-xs sm:text-base">Contactless</p>
            </div>
            <div>
              <h3 className="text-xl sm:text-3xl font-bold text-brand-500">60 Sec</h3>
              <p className="text-slate-500 mt-1 sm:mt-2 text-xs sm:text-base">Average Print</p>
            </div>
          </motion.div>
        </motion.div>

        {/* Right Image */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.2, ease: [0.21, 0.47, 0.32, 0.98] }}
          className="flex justify-center relative order-first lg:order-last"
        >
          <div className="absolute w-56 h-56 sm:w-80 sm:h-80 bg-brand-200/30 rounded-full blur-[100px] sm:blur-[120px]" />
          <img
            src="/images/SnapPrints-hero-machine.png"
            alt="SnapPrints Machine"
            className="relative w-48 sm:w-64 md:w-80 lg:w-[430px] h-auto rounded-3xl drop-shadow-[0_0_40px_rgba(19,107,255,0.25)] animate-float"
          />
        </motion.div>
      </div>

      {/* Bottom Feature Strip */}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="border-t border-slate-200 bg-white/60 backdrop-blur"
      >
        <div className="max-w-7xl mx-auto grid sm:grid-cols-3 gap-5 sm:gap-8 px-4 sm:px-6 py-6 sm:py-8">
          <div className="text-center">
            <h4 className="font-semibold text-brand-600 text-sm sm:text-base">Secure Printing</h4>
            <p className="text-slate-500 text-xs sm:text-sm mt-1 sm:mt-2">Files are deleted automatically after printing.</p>
          </div>
          <div className="text-center">
            <h4 className="font-semibold text-brand-600 text-sm sm:text-base">Instant Printing</h4>
            <p className="text-slate-500 text-xs sm:text-sm mt-1 sm:mt-2">Print documents in under one minute.</p>
          </div>
          <div className="text-center">
            <h4 className="font-semibold text-brand-600 text-sm sm:text-base">UPI Payments</h4>
            <p className="text-slate-500 text-xs sm:text-sm mt-1 sm:mt-2">Fast and secure digital payments.</p>
          </div>
        </div>
      </motion.div>
    </section>
  );
}