// parts/Counter.jsx — − value + with proper labels and 44 px touch targets
import React from "react";
import { useT } from "../../../i18n";

export default function Counter({ id, label, value, onChange, min = 1, max = 50 }) {
  const { t } = useT();
  return (
    <div className="pf-counter" role="group" aria-labelledby={`${id}-label`}>
      <button
        type="button"
        className="pf-counter-btn"
        aria-label={t("options.decrease", { label })}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >−</button>
      <span className="pf-counter-value" id={id} aria-live="polite">{value}</span>
      <button
        type="button"
        className="pf-counter-btn"
        aria-label={t("options.increase", { label })}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >+</button>
    </div>
  );
}
