import express from "express";
import { scrapeGoogleMaps } from "../services/scraper.service.js";
import Lead from "../models/Lead.js";

const router = express.Router();

router.post("/search", async (req, res) => {

    try {

        const { query } = req.body;

        const results = await scrapeGoogleMaps(query);

        const savedLeads = await Lead.insertMany(results);

        res.json({
            success: true,
            leads: savedLeads
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

});

export default router;