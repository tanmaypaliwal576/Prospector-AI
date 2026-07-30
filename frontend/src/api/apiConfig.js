// Central API URL Configuration for Netlify & Production
const DEFAULT_URL = "https://prospector-ai-qzg1.onrender.com/api";
const rawUrl = (import.meta.env.VITE_API_BASE_URL || DEFAULT_URL).trim().replace(/\/$/, "");
export const API_BASE_URL = rawUrl === "" ? DEFAULT_URL : (rawUrl.endsWith("/api") ? rawUrl : `${rawUrl}/api`);
