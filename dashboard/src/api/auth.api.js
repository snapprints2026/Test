import axiosClient from "./axiosClient";

export const adminLogin = (email, password) =>
  axiosClient.post("/auth/admin/login", { email, password }).then((r) => r.data);

export const vendorLogin = (email, password) =>
  axiosClient.post("/auth/vendor/login", { email, password }).then((r) => r.data);

export const officerLogin = (email, password) =>
  axiosClient.post("/auth/officer/login", { email, password }).then((r) => r.data);
