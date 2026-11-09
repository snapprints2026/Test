import { calculatePrice } from "./utils/pricing";

// Must stay in sync with the backend (src/services/pricing.service.js)
test("B&W single-sided: ₹2 per page", () => {
  expect(calculatePrice({ pages: 5, copies: 2, color: "bw", printSide: "single" }).total).toBe(20);
});

test("colour duplex: ₹10 per sheet, odd pages round up", () => {
  expect(calculatePrice({ pages: 3, copies: 1, color: "color", printSide: "duplex" }).total).toBe(20);
});
