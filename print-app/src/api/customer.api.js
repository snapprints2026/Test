// src/api/customer.api.js — logged-in customer's profile & history
import { apiRequest } from "./client";

// → { name, mobile }   (also used to check a saved token is still valid)
export const getMe = () => apiRequest("/customer/me");

// → { success, name }
export const updateName = (name) =>
  apiRequest("/customer/profile", { method: "PATCH", body: { name } });

// → { jobs: [...] }
export const getHistory = () => apiRequest("/customer/history");

// DPDP: erase my name and number
export const deleteAccount = () => apiRequest("/customer/me", { method: "DELETE" });
