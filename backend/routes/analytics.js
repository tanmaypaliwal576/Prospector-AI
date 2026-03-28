import express from "express";
import { getSummaryAnalytics } from "../services/analytics.service.js";

const router = express.Router();

router.get("/summary", async (req, res) => {
  try {
    const data = await getSummaryAnalytics();
    res.json(data);
  } catch (error) {
    console.error("Analytics route error:", error);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

export default router;