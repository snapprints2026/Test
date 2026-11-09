import { GraduationCap, Store, Landmark, Building2 } from "lucide-react";
import Reveal from "./Reveal";

// Who SnapPrints is for — the four customer segments (see "What We Offer Each Customer Segment").
const segments = [
  {
    icon: GraduationCap,
    title: "Colleges",
    who: "Student pays · kiosk on campus",
    points: ["Assignments, notes and reports from the phone", "Photo of card for ID copies", "OTP at the kiosk, no queue"],
  },
  {
    icon: Store,
    title: "Xerox shops",
    who: "Customer pays · shop computer",
    points: ["Prints on the right copier automatically", "Pickup code like K47 at the counter", "Photocopy and scan by the shopkeeper"],
  },
  {
    icon: Landmark,
    title: "Government offices",
    who: "Citizen or department pays · RTO, tehsil, municipal",
    points: ["Aadhaar, PAN, licence copies — even from a photo of the card", "Office forms (RTO Form 1, 1A…) from a list", "मराठी / हिन्दी / English, strict privacy"],
  },
  {
    icon: Building2,
    title: "Banks & PSUs",
    who: "Customer or branch pays · branch counter",
    points: ["KYC copies from a photo of the card", "Branch forms printed on demand", "Read-only reports for the branch manager"],
  },
];

export default function Segments() {
  return (
    <section id="solutions" className="bg-brand-50/50 py-16 sm:py-24 text-brand-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <Reveal className="text-center mb-10 sm:mb-14">
          <p className="text-brand-500 uppercase tracking-[0.25em] sm:tracking-[0.35em] font-semibold text-xs sm:text-sm">Solutions</p>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold mt-4 sm:mt-5">One Platform, Four Kinds of Customers</h2>
          <p className="text-slate-500 max-w-3xl mx-auto mt-4 sm:mt-6 text-base sm:text-lg">
            Scan the QR, upload or pick what you need, pay and collect — the same simple flow on campus, at the shop counter,
            in a government office or a bank branch.
          </p>
        </Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {segments.map((s, i) => {
            const Icon = s.icon;
            return (
              <Reveal key={s.title} delay={i * 0.08}>
                <div className="h-full rounded-2xl border border-slate-200 bg-white p-6 hover:border-brand-400 transition-colors">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100">
                    <Icon className="h-6 w-6 text-brand-600" aria-hidden="true" />
                  </div>
                  <h3 className="mt-5 text-xl font-semibold">{s.title}</h3>
                  <p className="mt-1 text-xs font-medium text-brand-600">{s.who}</p>
                  <ul className="mt-4 space-y-2 text-sm text-slate-600">
                    {s.points.map((p) => (
                      <li key={p} className="flex gap-2"><span className="text-brand-500" aria-hidden="true">•</span><span>{p}</span></li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
