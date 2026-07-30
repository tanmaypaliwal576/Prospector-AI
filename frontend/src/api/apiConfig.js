// Central API URL Configuration
const rawUrl = (import.meta.env.VITE_API_BASE_URL || "/api").trim().replace(/\/$/, "");
export const API_BASE_URL = rawUrl === "" ? "/api" : (rawUrl.endsWith("/api") ? rawUrl : `${rawUrl}/api`);
