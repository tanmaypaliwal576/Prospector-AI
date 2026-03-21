import { Worker } from "bullmq";
import { redisConnection } from "../redis/redis.connection.js";

import mongoose from "mongoose";
import dotenv from "dotenv";

import Lead from "../models/Lead.js";
import { extractWebsiteText } from "../utils/website.extractor.js";
import { lightExtract } from "../utils/light.extractor.js";
import { analyzeBusiness } from "../services/gemini.service.js";
import { calculateLeadScore } from "../utils/leadScoring.js";

dotenv.config();

mongoose.connect(process.env.MONGO_URI)
  .then(() => {

    console.log("🚀 Enrichment Worker Started");

    new Worker(
      "enrichmentQueue",

      async (job) => {
        const { website } = job.data;

        console.log("Enriching:", website);

        const lead = await Lead.findOne({ website });
        if (!lead || lead.enriched) return;

        if (
          website.includes("instagram.com") ||
          website.includes("linkedin.com") ||
          website.includes("facebook.com")
        ) {
          console.log("Skipping social:", website);
          return;
        }

        try {
          let text = await lightExtract(website);

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

          const leadQuality = calculateLeadScore(
            { ...aiData, website, phone: lead.phone },
            text.length
          );

          await Lead.updateOne(
            { website },
            {
              $set: {
                services: aiData.services,
                businessType: aiData.businessType,
                description: aiData.description,
                ownerName: aiData.ownerName,
                emailGuess,
                leadQuality,
                enriched: true
              }
            }
          );

          console.log(`✅ Enriched (${leadQuality}):`, website);

        } catch (err) {
          console.log("❌ Worker Error FULL:", err);
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