import express from "express";
import { scraperQueue } from "../queues/scraper.queue.js";
import Lead from "../models/Lead.js";

const router = express.Router();

/* START SCRAPING */

router.post("/search", async (req, res) => {
  try {

    const { query } = req.body;

    if (!query) {
      return res.status(400).json({
        success: false,
        message: "Query is required"
      });
    }

    const job = await scraperQueue.add("scrapeLeads", { query });

    res.json({
      success: true,
      jobId: job.id,
      message: "Scraping job added to queue"
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      message: error.message
    });

  }
});

/* GET ALL LEADS */

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

export default router;