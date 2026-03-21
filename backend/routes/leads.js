import express from "express";
import { scraperQueue } from "../queues/scraper.queue.js";
import { redisConnection } from "../redis/redis.connection.js";
import Lead from "../models/Lead.js";

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

    // 🔥 MUST MATCH WORKER NAME
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
   GET ALL LEADS
========================= */

router.get("/", async (req, res) => {
  try {
    const leads = await Lead.find().sort({ createdAt: -1 });

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

export default router;