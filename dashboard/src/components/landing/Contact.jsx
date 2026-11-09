import { Mail, Phone, MapPin, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import Reveal from "./Reveal";

export default function Contact({ onDemoClick }) {
  return (
    <section id="contact" className="bg-white py-16 sm:py-28 text-brand-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <Reveal>
          <div className="rounded-2xl sm:rounded-3xl border border-slate-200 bg-gradient-to-br from-brand-50 to-white p-6 sm:p-12 lg:p-16">
            <div className="grid lg:grid-cols-2 gap-10 sm:gap-16 items-center">
              {/* Left */}
              <div className="text-center lg:text-left">
                <p className="text-brand-500 uppercase tracking-[0.25em] sm:tracking-[0.35em] font-semibold text-xs sm:text-sm">Contact Us</p>
                <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mt-4 sm:mt-5 leading-tight text-brand-900">
                  Ready to Modernize
                  <span className="text-brand-500"> Printing?</span>
                </h2>
                <p className="mt-6 sm:mt-8 text-slate-500 text-base sm:text-lg leading-7 sm:leading-8">
                  Whether you&apos;re a college, office, hospital or public organization, SnapPrints can provide a fast
                  and secure self-service printing solution.
                </p>
                <motion.button
                  whileHover={{ scale: 1.04, y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={onDemoClick}
                  className="mt-8 sm:mt-10 flex items-center gap-3 rounded-xl bg-brand-500 px-6 sm:px-8 py-3.5 sm:py-4 font-semibold text-white transition-colors hover:bg-brand-600 mx-auto lg:mx-0"
                >
                  Request Demo
                  <ArrowRight size={18} />
                </motion.button>
              </div>

              {/* Right */}
              <div className="space-y-4 sm:space-y-8">
                {[
                  { Icon: Mail, label: "Email", value: "snapprintscontact@gmail.com", href: "mailto:snapprintscontact@gmail.com", breakAll: true },
                  { Icon: Phone, label: "Phone", value: "+91 7798305769", href: "tel:+917798305769" },
                  { Icon: MapPin, label: "Location", value: "Ahilyanagar, Maharashtra, India" },
                ].map(({ Icon, label, value, href, breakAll }, i) => (
                  <Reveal key={label} delay={i * 0.1} y={16}>
                    <motion.div
                      whileHover={{ x: 6 }}
                      transition={{ type: "spring", stiffness: 300, damping: 20 }}
                      className="flex items-center gap-4 sm:gap-5 rounded-xl sm:rounded-2xl border border-slate-200 bg-white p-4 sm:p-6"
                    >
                      <Icon className="text-brand-500 shrink-0" size={22} />
                      <div>
                        <h4 className="font-semibold text-sm sm:text-base text-brand-900">{label}</h4>
                        {href ? (
                          <a
                            href={href}
                            className={`text-slate-500 text-sm sm:text-base hover:text-brand-600 transition ${breakAll ? "break-all" : ""}`}
                          >
                            {value}
                          </a>
                        ) : (
                          <p className={`text-slate-500 text-sm sm:text-base ${breakAll ? "break-all" : ""}`}>{value}</p>
                        )}
                      </div>
                    </motion.div>
                  </Reveal>
                ))}
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
