import { Worker } from "bullmq";
import { redisConnection } from "../redis/redis.connection.js";
import mongoose from "mongoose";
import dotenv from "dotenv";

import Lead from "../models/Lead.js";
import { extractWebsiteText } from "../utils/website.extractor.js";
import { lightExtract } from "../utils/light.extractor.js";
import { analyzeBusiness } from "../services/gemini.service.js";

dotenv.config();

mongoose.connect(process.env.MONGO_URI)
  .then(() => {

    console.log("Enrichment Worker Started");

    const worker = new Worker(
      "enrichmentQueue",

      async (job) => {

        const { website } = job.data;

        console.log("Enriching:", website);

        const lead = await Lead.findOne({ website });
        if (!lead) return;

        if (lead.enriched) {
          console.log("Already enriched:", website);
          return;
        }

        if (
          website.includes("instagram.com") ||
          website.includes("linkedin.com") ||
          website.includes("facebook.com")
        ) {
          console.log("Skipping social:", website);
          return;
        }

        try {

          // LIGHT SCRAPER
          let text = await lightExtract(website);

          // FALLBACK
          if (!text || text.length < 500) {
            console.log("Fallback to Puppeteer:", website);
            text = await extractWebsiteText(website);
          }

          if (!text || text.length < 500) {
            console.log("Low quality site:", website);
            return;
          }

          console.log("Text length:", text.length);

          const aiData = await analyzeBusiness(text);

          if (!aiData) {
            console.log("AI failed:", website);
            return;
          }

          let emailGuess = null;
          try {
            const domain = new URL(website).hostname.replace("www.", "");
            emailGuess = `info@${domain}`;
          } catch {}

          await Lead.updateOne(
            { website },
            {
              $set: {
                services: aiData.services || [],
                businessType: aiData.businessType || null,
                description: aiData.description || null,
                ownerName: aiData.ownerName || null,
                emailPattern: aiData.emailPattern || null,
                emailGuess,
                enriched: true
              }
            }
          );

          console.log("✅ Enriched:", website);

        } catch (err) {

          if (err.message === "QUOTA_EXCEEDED") {
            console.log("🚫 Quota exhausted → retry later:", website);
            throw err;
          }

          console.log("Error:", err.message);
          throw err;
        }

      },

      {
        connection: redisConnection,
        concurrency: 1
      }
    );

  })
  .catch(err => console.log("MongoDB error:", err));