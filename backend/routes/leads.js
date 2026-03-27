import express from "express";
import { scraperQueue } from "../queues/scraper.queue.js";
import { redisConnection } from "../redis/redis.connection.js";
import Lead from "../models/Lead.js";
import { exportToCSV } from "../utils/exporter.js"; // ✅ IMPORTANT

const router = express.Router();

/* =========================
   START SCRAPING
========================= */
router.post("/search", async (req, res) => {
  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({
        success: false,
        message: "Query is required"
      });
    }

    const job = await scraperQueue.add("scrape", { query });

    res.json({
      success: true,
      jobId: job.id,
      message: "Scraping started"
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/* =========================
   GET ALL LEADS (WITH FILTERS)
========================= */
router.get("/", async (req, res) => {
  try {
    const { quality, query } = req.query;

    let filter = {};

    if (quality) {
      filter.leadQuality = quality;
    }

    if (query) {
      filter.sourceQuery = query;
    }

    const leads = await Lead.find(filter).sort({ createdAt: -1 });

    res.json({
      success: true,
      leads
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/* =========================
   STATS API (DASHBOARD)
========================= */
router.get("/stats", async (req, res) => {
  try {
    const total = await Lead.countDocuments();

    const high = await Lead.countDocuments({ leadQuality: "High" });
    const medium = await Lead.countDocuments({ leadQuality: "Medium" });
    const low = await Lead.countDocuments({ leadQuality: "Low" });

    const enriched = await Lead.countDocuments({ status: "enriched" });

    res.json({
      success: true,
      stats: {
        total,
        high,
        medium,
        low,
        enriched
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/* =========================
   PROGRESS API
========================= */
router.get("/progress/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;

    const total = await redisConnection.get(`scrape:${jobId}:total`);
    const done = await redisConnection.get(`scrape:${jobId}:done`);

    res.json({
      success: true,
      total: Number(total) || 0,
      done: Number(done) || 0
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/* =========================
   EXPORT CSV
========================= */
router.get("/export/csv", async (req, res) => {
  try {
    const { limit = 100 } = req.query;

    const leads = await Lead.find()
      .sort({ createdAt: -1 })
      .limit(Number(limit));

    if (!leads.length) {
      return res.status(404).json({
        success: false,
        message: "No leads found"
      });
    }

    const csv = exportToCSV(leads);

    res.header("Content-Type", "text/csv");
    res.attachment("leads.csv");

    return res.send(csv);

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

export default router;