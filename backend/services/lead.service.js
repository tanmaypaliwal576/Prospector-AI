import express from "express";
import { scraperQueue } from "../queues/scraper.queue.js";
import { redisConnection } from "../redis/redis.connection.js";
import Lead from "../models/Lead.js";
import { exportToCSV } from "../utils/exporter.js";

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
   GET LEADS (PAGINATED + FILTERED)
========================= */
router.get("/", async (req, res) => {
  try {
    const {
      quality,
      query,
      minRating,
      maxRating,
      search,
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      order = "desc"
    } = req.query;

    const filter = {};

    if (quality) filter.leadQuality = quality;
    if (query) filter.sourceQuery = query;

    if (minRating || maxRating) {
      filter.rating = {};
      if (minRating) filter.rating.$gte = Number(minRating);
      if (maxRating) filter.rating.$lte = Number(maxRating);
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { address: { $regex: search, $options: "i" } },
        { website: { $regex: search, $options: "i" } },
        { businessType: { $regex: search, $options: "i" } }
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const leads = await Lead.find(filter)
      .sort({ [sortBy]: order === "asc" ? 1 : -1 })
      .skip(skip)
      .limit(Number(limit));

    const total = await Lead.countDocuments(filter);

    res.json({
      success: true,
      leads,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / limit)
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
   STATS API (OPTIMIZED)
========================= */
router.get("/stats", async (req, res) => {
  try {
    const stats = await Lead.aggregate([
      {
        $group: {
          _id: "$leadQuality",
          count: { $sum: 1 }
        }
      }
    ]);

    const total = await Lead.countDocuments();
    const enriched = await Lead.countDocuments({ status: "enriched" });

    const formatted = {
      High: 0,
      Medium: 0,
      Low: 0
    };

    stats.forEach((s) => {
      formatted[s._id] = s.count;
    });

    res.json({
      success: true,
      stats: {
        total,
        enriched,
        ...formatted
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
   EXPORT CSV (FILTERED)
========================= */
router.get("/export/csv", async (req, res) => {
  try {
    const {
      quality,
      query,
      minRating,
      maxRating,
      search,
      limit = 100
    } = req.query;

    const filter = {};

    if (quality) filter.leadQuality = quality;
    if (query) filter.sourceQuery = query;

    if (minRating || maxRating) {
      filter.rating = {};
      if (minRating) filter.rating.$gte = Number(minRating);
      if (maxRating) filter.rating.$lte = Number(maxRating);
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { address: { $regex: search, $options: "i" } },
        { website: { $regex: search, $options: "i" } },
        { businessType: { $regex: search, $options: "i" } }
      ];
    }

    const leads = await Lead.find(filter)
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