import { Worker } from "bullmq";
import { redisConnection } from "../redis/redis.connection.js";
import mongoose from "mongoose";
import dotenv from "dotenv";

import Lead from "../models/Lead.js";
import { extractWebsiteText } from "../utils/website.extractor.js";
import { analyzeBusiness } from "../services/gemini.service.js";

dotenv.config();

mongoose.connect(process.env.MONGO_URI)
.then(() => {

console.log("Enrichment Worker Started");
console.log(process.env.GEMINI_API_KEY);
new Worker(

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

    /* Skip social media */

    if (
      website.includes("instagram.com") ||
      website.includes("linkedin.com") ||
      website.includes("facebook.com")
    ) {
      console.log("Skipping social site:", website);
      return;
    }

    /* Extract website content */

    const text = await extractWebsiteText(website);

    if (!text) {
        console.log("No website content:", website);
        return;
    }

    console.log("Website text length:", text.length);

    /* Gemini AI */

    const aiData = await analyzeBusiness(text);

    if (!aiData) {
        console.log("AI extraction failed:", website);
        return;
    }

    /* Email guess */

    let emailGuess = null;

    try {

      const domain = new URL(website).hostname.replace("www.", "");

      emailGuess = `info@${domain}`;

    } catch {}

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

    console.log("Lead enriched with Gemini:", website);

},

{
connection: redisConnection,
concurrency: 2
}

);

})
.catch(err => console.log("MongoDB connection error:", err));