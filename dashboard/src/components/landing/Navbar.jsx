import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function Navbar({ onDemoClick }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const navLinks = [
    { label: "Home", href: "#" },
    { label: "Features", href: "#features" },
    { label: "Solutions", href: "#solutions" },
    { label: "How It Works", href: "#how" },
    { label: "Contact", href: "#contact" },
  ];

  const closeMenu = () => setMobileOpen(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll);
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={
        "fixed top-0 left-0 w-full z-50 backdrop-blur-xl transition-all duration-300 " +
        (scrolled
          ? "bg-white/90 border-b border-slate-200 shadow-lg shadow-slate-900/5"
          : "bg-white/40 border-b border-transparent")
      }
    >
      <div className="max-w-7xl mx-auto flex h-16 sm:h-20 items-center justify-between px-4 sm:px-6">
        {/* Logo */}
        <div className="flex items-center gap-2 sm:gap-3 cursor-pointer" onClick={closeMenu}>
          <img
            src="/images/logo.png"
            alt="SnapPrints Logo"
            width={68}
            height={68}
            className="rounded-lg w-9 h-9 sm:w-[50px] sm:h-[50px]"
          />
          <div>
            <h1 className="text-lg sm:text-2xl font-bold tracking-tight text-brand-900">
              Snap<span className="text-brand-500">Prints</span>
            </h1>
            <p className="hidden sm:block text-[11px] uppercase tracking-[0.25em] text-slate-500">
              Print Anytime Anywhere
            </p>
          </div>
        </div>

        {/* Desktop Navigation */}
        <div className="hidden lg:flex items-center gap-10">
          <a href="#" className="relative text-brand-900 font-medium transition hover:text-brand-600">
            Home
            <span className="absolute -bottom-2 left-0 h-[2px] w-full bg-brand-500"></span>
          </a>
          <a href="#features" className="font-medium text-slate-600 transition hover:text-brand-600">
            Features
          </a>
          <a href="#solutions" className="font-medium text-slate-600 transition hover:text-brand-600">
            Solutions
          </a>
          <a href="#how" className="font-medium text-slate-600 transition hover:text-brand-600">
            How It Works
          </a>
          <a href="#contact" className="font-medium text-slate-600 transition hover:text-brand-600">
            Contact
          </a>
        </div>

        {/* Desktop CTA Buttons */}
        <div className="hidden lg:flex items-center gap-3">
          <Link
            to="/login"
            className="flex items-center rounded-xl border border-slate-300 px-5 py-3 font-semibold text-slate-700 transition hover:border-brand-400 hover:text-brand-600"
          >
            Login
          </Link>
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            onClick={onDemoClick}
            className="flex items-center rounded-xl bg-brand-500 px-6 py-3 font-semibold text-white shadow-lg shadow-brand-500/30 transition-colors hover:bg-brand-600"
          >
            Request Demo
          </motion.button>
        </div>

        {/* Mobile Hamburger */}
        <button
          className="lg:hidden text-brand-900 p-2 -mr-2"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
        >
          {mobileOpen ? <X size={26} /> : <Menu size={26} />}
        </button>
      </div>

      {/* Mobile Menu Panel */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="lg:hidden overflow-hidden border-t border-slate-200 bg-white/95 backdrop-blur-xl"
          >
            <div className="flex flex-col px-4 py-4 gap-1">
              {navLinks.map(function (item) {
                return (
                  <a key={item.label} href={item.href} onClick={closeMenu} className="text-slate-700 font-medium py-3 px-2 rounded-lg transition hover:bg-brand-50 hover:text-brand-600">
                    {item.label}
                  </a>
                );
              })}

              <div className="flex flex-col gap-3 mt-3 pt-3 border-t border-slate-200">
                <Link
                  to="/login"
                  onClick={closeMenu}
                  className="text-center rounded-xl border border-slate-300 px-5 py-3 font-semibold text-slate-700 transition hover:border-brand-400 hover:text-brand-600"
                >
                  Login
                </Link>
                <button
                  onClick={() => {
                    closeMenu();
                    onDemoClick();
                  }}
                  className="rounded-xl bg-brand-500 px-6 py-3 font-semibold text-white transition hover:bg-brand-600"
                >
                  Request Demo
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
