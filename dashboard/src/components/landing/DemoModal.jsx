import { useState, useMemo } from "react";
import { X, ArrowLeft, Rocket, MapPin, Building2, Check } from "lucide-react";
// Small built-in list (~21 KB gzipped): all countries + every Indian state and city.
// Replaces the 2.3 MB country-state-city download that kept phones stuck on "Loading…".
import LOCATIONS from "../../data/locations.json";
import { motion, AnimatePresence } from "framer-motion";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000/api";

const OPTIONS = [
  {
    id: "own_kiosk",
    icon: Rocket,
    title: "I want to own a SnapPrints kiosk",
    recommended: true,
    description: "Own a SnapPrints kiosk and earn from every print.",
  },
  {
    id: "host_kiosk",
    icon: MapPin,
    title: "I have a location and want to host a kiosk",
    recommended: false,
    description: "Let us install and operate a SnapPrints kiosk at your location.",
  },
  {
    id: "custom_solution",
    icon: Building2,
    title: "I need a custom solution",
    recommended: false,
    description: "For universities, businesses, export inquiries, distributors, or multiple kiosk requirements.",
  },
];

const STEPS = [
  { id: "model", label: "Franchise Model" },
  { id: "details", label: "Your Details" },
  { id: "final", label: "Final Step" },
];

const LANGUAGES = ["English", "Hindi", "Marathi", "Other"];

const DEFAULT_COUNTRY = "India";
const OTHER_CITY = "__other__"; // "My city isn't listed"

function StepIndicator({ currentIndex }) {
  return (
    <div className="flex items-center justify-center mb-8">
      {STEPS.map((step, i) => {
        const isDone = i < currentIndex;
        const isActive = i === currentIndex;
        return (
          <div key={step.id} className="flex items-center">
            <div className="flex flex-col items-center">
              <motion.div
                animate={{
                  backgroundColor: isDone || isActive ? "#2457ff" /* brand-500 */ : "#e5e7eb",
                  color: isDone || isActive ? "#ffffff" : "#9ca3af",
                }}
                transition={{ duration: 0.3 }}
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center font-semibold text-xs sm:text-sm"
              >
                {isDone ? <Check size={14} /> : i + 1}
              </motion.div>
              <span className={`mt-2 text-[10px] sm:text-sm font-medium text-center ${isDone || isActive ? "text-brand-600" : "text-gray-400"}`}>
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className="w-8 sm:w-20 h-[2px] mx-1.5 sm:mx-2 mb-6 relative bg-gray-200 overflow-hidden">
                <motion.div
                  initial={false}
                  animate={{ width: isDone ? "100%" : "0%" }}
                  transition={{ duration: 0.3 }}
                  className="absolute inset-y-0 left-0 bg-brand-500"
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function DemoModal({ open, onClose }) {
  const [stepIndex, setStepIndex] = useState(0); // 0=model, 1=details, 2=final
  const [selectedOption, setSelectedOption] = useState(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [captchaChecked, setCaptchaChecked] = useState(false);

  const [cityNotListed, setCityNotListed] = useState(false);

  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    organisation: "",
    country: DEFAULT_COUNTRY,
    state: "",
    city: "",
    language: "",
    message: "",
  });

  const isIndia = form.country === "India";
  const cities = useMemo(
    () => (isIndia ? LOCATIONS.indiaStates.find((st) => st.name === form.state)?.cities || [] : []),
    [isIndia, form.state]
  );

  if (!open) return null;

  const resetAndClose = () => {
    setStepIndex(0);
    setSelectedOption(null);
    setSuccess(false);
    setError("");
    setCaptchaChecked(false);
    setCityNotListed(false);
    setForm({
      name: "", phone: "", email: "", organisation: "",
      country: DEFAULT_COUNTRY, state: "", city: "", language: "", message: "",
    });
    onClose();
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleCountryChange = (e) => {
    setCityNotListed(false);
    setForm((prev) => ({ ...prev, country: e.target.value, state: "", city: "" }));
  };

  const handleStateChange = (e) => {
    setCityNotListed(false);
    setForm((prev) => ({ ...prev, state: e.target.value, city: "" }));
  };

  const handleCitySelect = (e) => {
    const value = e.target.value;
    if (value === OTHER_CITY) {
      setCityNotListed(true);
      setForm((prev) => ({ ...prev, city: "" }));
    } else {
      setForm((prev) => ({ ...prev, city: value }));
    }
  };

  const chooseOption = (opt) => {
    setSelectedOption(opt);
    setStepIndex(1);
  };

  const goNext = () => {
    if (!form.name.trim() || !form.phone.trim() || !form.email.trim() || !form.organisation.trim()) {
      setError("Please fill in all required fields.");
      return;
    }
    if (!form.country.trim() || !form.state.trim() || !form.city.trim()) {
      setError("Please select your country, state, and city.");
      return;
    }
    setError("");
    setStepIndex(2);
  };

  const goBack = () => {
    setError("");
    setStepIndex((i) => Math.max(0, i - 1));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.message.trim()) {
      setError("Please tell us a bit about your requirement.");
      return;
    }
    if (!captchaChecked) {
      setError("Please confirm you're not a robot.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE}/request-demo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interestType: selectedOption?.id,
          name: form.name,
          phone: form.phone,
          email: form.email,
          organisation: form.organisation,
          country: form.country,
          state: form.state,
          city: form.city,
          language: form.language,
          message: form.message,
        }),
      });

      if (!response.ok) throw new Error("Unable to send request.");
      setSuccess(true);
    } catch {
      setError("Something went wrong. Please try again.");
    }

    setLoading(false);
  };

  const inputClass =
    "w-full rounded-xl bg-white border border-slate-300 p-3.5 sm:p-4 text-brand-900 text-sm sm:text-base placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400 disabled:bg-slate-50 disabled:text-slate-400";

  return (
    <div className="fixed inset-0 z-[100] bg-brand-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.25, ease: [0.21, 0.47, 0.32, 0.98] }}
        className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 max-w-2xl w-full p-5 sm:p-8 relative max-h-[90vh] overflow-y-auto shadow-2xl shadow-brand-900/20"
      >
        <div className="flex justify-end -mt-1 -mr-1 mb-1">
          <button
            onClick={resetAndClose}
            className="text-slate-400 hover:text-brand-900 p-2 rounded-lg hover:bg-slate-100 transition-colors"
            aria-label="Close"
          >
            <X size={22} />
          </button>
        </div>

        <AnimatePresence mode="wait">
          {success ? (
            <motion.div
              key="success"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-6 sm:py-10"
            >
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                <span className="text-4xl sm:text-5xl">✅</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold mt-6 sm:mt-8 text-brand-900">Thank You!</h2>
              <p className="text-slate-500 mt-4 sm:mt-5 leading-7 sm:leading-8 text-sm sm:text-base">
                Your request has been submitted successfully.
                <br />
                Our team will contact you shortly.
              </p>
              <button
                onClick={resetAndClose}
                className="mt-8 sm:mt-10 bg-brand-500 px-8 py-3.5 sm:py-4 rounded-xl font-semibold hover:bg-brand-600 text-white transition-colors"
              >
                Close
              </button>
            </motion.div>
          ) : (
            <>
              <StepIndicator currentIndex={stepIndex} />

              {stepIndex === 0 && (
                <motion.div
                  key="model"
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.2 }}
                >
                  <h2 className="text-xl sm:text-2xl font-bold text-brand-900 mb-5 sm:mb-6">
                    How would you like to partner with SnapPrints?
                  </h2>

                  <div className="space-y-4">
                    {OPTIONS.map((opt, i) => {
                      const Icon = opt.icon;
                      const isSelected = selectedOption?.id === opt.id;
                      return (
                        <motion.button
                          key={opt.id}
                          type="button"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.07, duration: 0.3 }}
                          whileHover={{ y: -2 }}
                          onClick={() => chooseOption(opt)}
                          className={`w-full text-left rounded-2xl border-2 p-5 transition-colors ${
                            isSelected
                              ? "border-brand-500 bg-brand-50"
                              : "border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50/40"
                          }`}
                        >
                          <div className="flex items-start gap-4">
                            <span className="text-2xl shrink-0">
                              <Icon className="text-slate-700" size={26} />
                            </span>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="text-brand-900 font-semibold text-base sm:text-lg">{opt.title}</h3>
                                {opt.recommended && (
                                  <span className="bg-brand-500 text-white text-[10px] sm:text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-wide">
                                    Recommended
                                  </span>
                                )}
                              </div>
                              <p className="text-slate-500 text-sm sm:text-base mt-1">{opt.description}</p>
                            </div>
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {stepIndex === 1 && (
                <motion.div
                  key="details"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.2 }}
                >
                  <h2 className="text-xl sm:text-2xl font-bold text-brand-900 mb-5 sm:mb-6">Tell us about yourself</h2>

                  <div className="space-y-4">
                    <input
                      required
                      name="name"
                      placeholder="Full Name *"
                      value={form.name}
                      onChange={handleChange}
                      className={inputClass}
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                      <input
                        required
                        type="tel"
                        name="phone"
                        placeholder="Phone Number *"
                        value={form.phone}
                        onChange={handleChange}
                        className={inputClass}
                      />

                      <input
                        required
                        type="email"
                        name="email"
                        placeholder="Email Address *"
                        value={form.email}
                        onChange={handleChange}
                        className={inputClass}
                      />
                    </div>

                    <input
                      required
                      name="organisation"
                      placeholder="Organisation / Profession *"
                      value={form.organisation}
                      onChange={handleChange}
                      className={inputClass}
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                      <select required value={form.country} onChange={handleCountryChange} className={inputClass}>
                        {LOCATIONS.countries.map((name) => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>

                      {isIndia ? (
                        <>
                          <select required value={form.state} onChange={handleStateChange} className={inputClass}>
                            <option value="">Select State *</option>
                            {LOCATIONS.indiaStates.map((st) => (
                              <option key={st.code} value={st.name}>{st.name}</option>
                            ))}
                          </select>

                          {cityNotListed ? (
                            <input
                              required
                              autoFocus
                              name="city"
                              placeholder="Type your city *"
                              value={form.city}
                              onChange={handleChange}
                              className={inputClass}
                            />
                          ) : (
                            <select
                              required
                              value={form.city}
                              onChange={handleCitySelect}
                              className={inputClass}
                              disabled={!form.state}
                            >
                              <option value="">{form.state ? "Select City *" : "Select state first"}</option>
                              {cities.map((name) => (
                                <option key={name} value={name}>{name}</option>
                              ))}
                              {form.state && <option value={OTHER_CITY}>My city isn&apos;t listed</option>}
                            </select>
                          )}
                        </>
                      ) : (
                        <>
                          <input
                            required
                            name="state"
                            placeholder="State / Province *"
                            value={form.state}
                            onChange={handleChange}
                            className={inputClass}
                          />
                          <input
                            required
                            name="city"
                            placeholder="City *"
                            value={form.city}
                            onChange={handleChange}
                            className={inputClass}
                          />
                        </>
                      )}
                    </div>

                    <select name="language" value={form.language} onChange={handleChange} className={inputClass}>
                      <option value="">Language Preference</option>
                      {LANGUAGES.map((l) => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </select>
                  </div>

                  {error && (
                    <div className="mt-4 rounded-lg bg-red-50 border border-red-200 p-3 text-red-600 text-sm">
                      {error}
                    </div>
                  )}

                  <div className="flex gap-3 mt-6">
                    <button
                      type="button"
                      onClick={goBack}
                      className="flex-1 flex items-center justify-center gap-2 rounded-xl border-2 border-brand-500 text-brand-600 font-semibold py-3.5 hover:bg-brand-50 transition-colors"
                    >
                      <ArrowLeft size={18} /> Back
                    </button>
                    <button
                      type="button"
                      onClick={goNext}
                      className="flex-1 rounded-xl bg-brand-500 text-white font-semibold py-3.5 hover:bg-brand-600 transition-colors"
                    >
                      Next →
                    </button>
                  </div>
                </motion.div>
              )}

              {stepIndex === 2 && (
                <motion.form
                  key="final"
                  onSubmit={handleSubmit}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.2 }}
                >
                  {selectedOption && (
                    <div className="rounded-xl bg-brand-50 border border-slate-200 p-4 mb-5">
                      <p className="text-xs text-slate-500 mb-1">Selected model</p>
                      <div className="flex items-center gap-2">
                        <selectedOption.icon size={18} className="text-slate-700" />
                        <span className="font-semibold text-brand-900 text-sm sm:text-base">{selectedOption.title}</span>
                      </div>
                    </div>
                  )}

                  <h2 className="text-xl sm:text-2xl font-bold text-brand-900 mb-4">Anything you'd like us to know?</h2>

                  <textarea
                    required
                    rows={5}
                    name="message"
                    placeholder="Discussion Details *"
                    value={form.message}
                    onChange={handleChange}
                    className={inputClass}
                  />

                  <label className="mt-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-brand-50 p-4 cursor-pointer w-fit">
                    <input
                      type="checkbox"
                      checked={captchaChecked}
                      onChange={(e) => setCaptchaChecked(e.target.checked)}
                      className="w-5 h-5 rounded border-slate-400 text-brand-500 focus:ring-brand-400"
                    />
                    <span className="text-sm text-slate-700">I'm not a robot</span>
                  </label>

                  {error && (
                    <div className="mt-4 rounded-lg bg-red-50 border border-red-200 p-3 text-red-600 text-sm">
                      {error}
                    </div>
                  )}

                  <div className="flex gap-3 mt-6">
                    <button
                      type="button"
                      onClick={goBack}
                      className="flex-1 flex items-center justify-center gap-2 rounded-xl border-2 border-brand-500 text-brand-600 font-semibold py-3.5 hover:bg-brand-50 transition-colors"
                    >
                      <ArrowLeft size={18} /> Back
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="flex-1 rounded-xl bg-brand-500 text-white font-semibold py-3.5 hover:bg-brand-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {loading ? "Submitting..." : "Submit"}
                    </button>
                  </div>
                </motion.form>
              )}
            </>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}