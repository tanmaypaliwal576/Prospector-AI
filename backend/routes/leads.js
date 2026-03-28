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
    console.error("Search error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/* =========================
   GET LEADS (FINAL)
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

    // ✅ Only enriched leads (NOW SAFE)
    filter.status = "enriched";

    // ✅ Quality filter
    if (quality) {
      filter.leadQuality = {
        $regex: new RegExp(`^${quality}$`, "i")
      };
    }

    // ✅ Source query
    if (query) {
      filter.sourceQuery = {
        $regex: query,
        $options: "i"
      };
    }

    // ✅ Rating filter
    if (minRating || maxRating) {
      filter.rating = {};
      if (minRating) filter.rating.$gte = Number(minRating);
      if (maxRating) filter.rating.$lte = Number(maxRating);
      filter.rating.$ne = null;
    }

    // ✅ Search filter
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { address: { $regex: search, $options: "i" } },
        { website: { $regex: search, $options: "i" } },
        { businessType: { $regex: search, $options: "i" } }
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [leads, total] = await Promise.all([
      Lead.find(filter)
        .sort({ [sortBy]: order === "asc" ? 1 : -1 })
        .skip(skip)
        .limit(Number(limit)),
      Lead.countDocuments(filter)
    ]);

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
    console.error("Fetch leads error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/* =========================
   STATS API (FINAL)
========================= */
router.get("/stats", async (req, res) => {
  try {
    const stats = await Lead.aggregate([
      { $match: { status: "enriched" } },
      {
        $group: {
          _id: "$leadQuality",
          count: { $sum: 1 }
        }
      }
    ]);

    const total = await Lead.countDocuments({ status: "enriched" });

    const formatted = {
      High: 0,
      Medium: 0,
      Low: 0
    };

    stats.forEach((s) => {
      if (s._id) formatted[s._id] = s.count;
    });

    res.json({
      success: true,
      stats: {
        total,
        ...formatted
      }
    });

  } catch (error) {
    console.error("Stats error:", error);
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
    console.error("Progress error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/* =========================
   EXPORT CSV (FINAL)
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

    const filter = { status: "enriched" };

    if (quality) {
      filter.leadQuality = {
        $regex: new RegExp(`^${quality}$`, "i")
      };
    }

    if (query) {
      filter.sourceQuery = {
        $regex: query,
        $options: "i"
      };
    }

    if (minRating || maxRating) {
      filter.rating = {};
      if (minRating) filter.rating.$gte = Number(minRating);
      if (maxRating) filter.rating.$lte = Number(maxRating);
      filter.rating.$ne = null;
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
    console.error("Export error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

export default router;