import { GraduationCap, Building2, Hospital, Library, ShoppingBag, Train } from "lucide-react";
import { motion } from "framer-motion";
import Reveal from "./Reveal";

const industries = [
  { icon: GraduationCap, title: "Colleges" },
  { icon: Building2, title: "Corporate" },
  { icon: Hospital, title: "Hospitals" },
  { icon: Library, title: "Libraries" },
  { icon: ShoppingBag, title: "Shopping Malls" },
  { icon: Train, title: "Railway Stations" },
];

export default function TrustedBy() {
  return (
    <section className="bg-white py-16 sm:py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <Reveal className="text-center mb-10 sm:mb-16">
          <p className="text-brand-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] font-semibold text-xs sm:text-sm">Ideal For</p>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-brand-900 mt-3 sm:mt-4">Designed for Every Modern Workspace</h2>
          <p className="text-slate-500 max-w-2xl mx-auto mt-4 sm:mt-6 text-base sm:text-lg">
            SnapPrints is built for institutions and businesses that need fast, secure and self-service document
            printing.
          </p>
        </Reveal>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 sm:gap-6">
          {industries.map((industry, i) => {
            const Icon = industry.icon;
            return (
              <Reveal key={industry.title} delay={i * 0.06}>
                <motion.div
                  whileHover={{ y: -6 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  className="group rounded-xl sm:rounded-2xl border border-slate-200 bg-brand-50 p-5 sm:p-8 text-center hover:border-brand-400 hover:shadow-xl hover:shadow-brand-500/10 transition-colors"
                >
                  <div className="mx-auto flex h-12 w-12 sm:h-16 sm:w-16 items-center justify-center rounded-full bg-brand-100 transition-colors group-hover:bg-brand-200">
                    <Icon className="h-6 w-6 sm:h-8 sm:w-8 text-brand-600" />
                  </div>
                  <h3 className="mt-4 sm:mt-6 text-sm sm:text-lg font-semibold text-brand-900">{industry.title}</h3>
                </motion.div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
