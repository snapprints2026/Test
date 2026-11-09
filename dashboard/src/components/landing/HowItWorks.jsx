import { ScanLine, UploadCloud, CreditCard, Printer } from "lucide-react";
import { motion } from "framer-motion";
import Reveal from "./Reveal";

const steps = [
  { icon: ScanLine, title: "Scan QR Code", description: "Scan the QR code displayed on the SnapPrints kiosk using your mobile phone." },
  { icon: UploadCloud, title: "Upload Document", description: "Upload PDF, DOCX, PPT, images and other supported document formats." },
  { icon: CreditCard, title: "Make Payment", description: "Pay securely using UPI, Debit Card, Credit Card or Wallet." },
  { icon: Printer, title: "Collect Print", description: "Your document is printed instantly. Collect it directly from the machine." },
];

export default function HowItWorks() {
  return (
    <section id="how" className="bg-gradient-to-b from-brand-50 to-white py-16 sm:py-28 text-brand-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <Reveal className="text-center mb-12 sm:mb-20">
          <p className="text-brand-500 uppercase tracking-[0.25em] sm:tracking-[0.35em] font-semibold text-xs sm:text-sm">How It Works</p>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold mt-4 sm:mt-5">Print in Just 4 Simple Steps</h2>
          <p className="text-slate-500 mt-4 sm:mt-6 max-w-3xl mx-auto text-base sm:text-lg leading-7 sm:leading-8">
            SnapPrints makes document printing quick, secure and completely contactless. From scanning a QR code to
            collecting your print, everything takes less than a minute.
          </p>
        </Reveal>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
          {steps.map((step, index) => (
            <Reveal key={step.title} delay={index * 0.1}>
              <motion.div
                whileHover={{ y: -8 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className="group relative h-full rounded-2xl sm:rounded-3xl border border-slate-200 bg-white backdrop-blur-sm p-6 sm:p-8 hover:border-brand-400 hover:shadow-xl hover:shadow-brand-500/10 transition-colors"
              >
                <div className="absolute -top-4 left-5 sm:-top-5 sm:left-6 flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-full bg-brand-500 font-bold text-white text-sm sm:text-base shadow-lg shadow-brand-500/30">
                  {index + 1}
                </div>
                <div className="mt-3 mb-5 sm:mt-4 sm:mb-6 flex h-12 w-12 sm:h-16 sm:w-16 items-center justify-center rounded-xl sm:rounded-2xl bg-brand-100 group-hover:bg-brand-200 transition">
                  <step.icon size={26} className="text-brand-600 sm:w-[34px] sm:h-[34px]" />
                </div>
                <h3 className="text-xl sm:text-2xl font-semibold mb-3 sm:mb-4 text-brand-900">{step.title}</h3>
                <p className="leading-6 sm:leading-7 text-slate-500 text-sm sm:text-base">{step.description}</p>
              </motion.div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
