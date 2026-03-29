import axios from "axios";

const API = axios.create({
  baseURL: "http://localhost:5000/api"
});

export const fetchLeads = (params) => API.get("/leads", { params });

export const fetchStats = () => API.get("/leads/stats");

export const exportCSV = () =>
  window.open("http://localhost:5000/api/leads/export/csv");

export const startScrape = (query) =>
  API.post("/leads/search", { query });

export const getProgress = (jobId) =>
  API.get(`/leads/progress/${jobId}`);