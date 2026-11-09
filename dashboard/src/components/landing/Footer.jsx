export default function Footer() {
  return (
    <footer className="border-t border-brand-800 bg-brand-900 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 sm:py-14 grid sm:grid-cols-2 md:grid-cols-4 gap-8 sm:gap-10">
        {/* Logo */}
        <div className="col-span-2 sm:col-span-2 md:col-span-1">
          <div className="flex items-center gap-3">
            <img src="/images/SnapPrints-logo-transparent.png" alt="SnapPrints" width={45} height={45} className="w-9 h-9 sm:w-[45px] sm:h-[45px]" />
            <div>
              <h3 className="text-xl sm:text-2xl font-bold">
                Snap<span className="text-brand-400">Prints</span>
              </h3>
              <p className="text-[8px] sm:text-xs uppercase tracking-[0.2em] sm:tracking-[0.25em] text-brand-200">Print Anytime Anywhere</p>
            </div>
          </div>
          <p className="text-brand-200 mt-4 sm:mt-6 leading-6 sm:leading-7 text-sm sm:text-base">
            India&apos;s next-generation self-service printing solution designed for colleges, offices, hospitals and
            public spaces.
          </p>
        </div>

        {/* Company */}
        <div>
          <h4 className="font-semibold text-base sm:text-lg mb-3 sm:mb-5">Company</h4>
          <ul className="space-y-2 sm:space-y-3 text-brand-200 text-sm sm:text-base">
            <li><a href="#" className="hover:text-white transition">Home</a></li>
            <li><a href="#features" className="hover:text-white transition">Features</a></li>
            <li><a href="#how" className="hover:text-white transition">How It Works</a></li>
            <li><a href="#contact" className="hover:text-white transition">Contact</a></li>
          </ul>
        </div>

        {/* Solutions */}
        <div>
          <h4 className="font-semibold text-base sm:text-lg mb-3 sm:mb-5">Solutions</h4>
          <ul className="space-y-2 sm:space-y-3 text-brand-200 text-sm sm:text-base">
            <li>Colleges</li>
            <li>Corporate Offices</li>
            <li>Hospitals</li>
            <li>Libraries</li>
          </ul>
        </div>

        {/* Contact */}
        <div>
          <h4 className="font-semibold text-base sm:text-lg mb-3 sm:mb-5">Contact</h4>
          <ul className="space-y-2 sm:space-y-3 text-brand-200 text-sm sm:text-base break-words">
            <li>
              📧{" "}
              <a href="mailto:snapprintscontact@gmail.com" className="hover:text-white transition">
                snapprintscontact@gmail.com
              </a>
            </li>
            <li>
              📞{" "}
              <a href="tel:+917798305769" className="hover:text-white transition">
                +91 7798305769
              </a>
            </li>
            <li>📍 Ahilyanagar</li>
          </ul>
        </div>
      </div>

      <div className="border-t border-brand-800 py-4 sm:py-6 text-center text-brand-300 text-xs sm:text-sm px-4">
        © 2026 SnapPrints. All Rights Reserved.
      </div>
    </footer>
  );
}
