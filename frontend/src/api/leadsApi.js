import axios from "axios";
import { API_BASE_URL } from "./apiConfig.js";

const API = axios.create({
  baseURL: API_BASE_URL
});

export const fetchLeads = (params) => API.get("/leads", { params });

export const fetchStats = () => API.get("/leads/stats");

export const exportCSV = () =>
  window.open(`${API_BASE_URL}/leads/export/csv`);

export const startScrape = (query) =>
  API.post("/leads/search", { query });

export const getProgress = (jobId) =>
  API.get(`/leads/progress/${jobId}`);

export const fetchCredits = () => API.get("/user/credits");