import dotenv from "dotenv";
dotenv.config();

import { Worker } from "bullmq";
import mongoose from "mongoose";

import { redisConnection } from "../redis/redis.connection.js";

import Lead from "../models/Lead.js";
import { extractWebsiteText } from "../utils/website.extractor.js";
import { analyzeBusiness } from "../services/gemini.service.js";

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

        // ✅ Skip already enriched
        if (lead.enriched) {
          console.log("Already enriched:", website);
          return;
        }

        // ✅ Skip social domains
        if (
          website.includes("instagram.com") ||
          website.includes("linkedin.com") ||
          website.includes("facebook.com")
        ) {
          console.log("Skipping social:", website);
          return;
        }

        try {

          /* Extract content */
          const text = await extractWebsiteText(website);

          if (!text || text.length < 500) {
            console.log("Low quality site, skipping:", website);
            return;
          }

          console.log("Text length:", text.length);

          /* AI enrichment */
          const aiData = await analyzeBusiness(text);

          if (!aiData) {
            console.log("AI failed:", website);
            return;
          }

          /* Email guess */
          let emailGuess = null;
          try {
            const domain = new URL(website).hostname.replace("www.", "");
            emailGuess = `info@${domain}`;
          } catch { }

          await Lead.updateOne(
            { website },
            {
              $set: {
                services: aiData.services,
                businessType: aiData.businessType,
                description: aiData.description,
                emailGuess,
                enriched: true
              }
            }
          );

          console.log("✅ Enriched:", website);

        } catch (err) {

          if (err.message === "QUOTA_EXCEEDED") {

            console.log("🚫 Quota exhausted. Delaying job 24h:", website);

            await job.moveToDelayed(Date.now() + 24 * 60 * 60 * 1000);

            return;
          }

          console.log("Error:", err.message);
        }

      },

      {
        connection: redisConnection,
        concurrency: 1
      }
    }
  );

  })
  .catch(err => console.log("MongoDB error:", err));
