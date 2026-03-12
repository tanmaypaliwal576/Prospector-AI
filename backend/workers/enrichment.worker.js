import { Worker } from "bullmq";
import { redisConnection } from "../redis/redis.connection.js";
import mongoose from "mongoose";
import dotenv from "dotenv";

import Lead from "../models/Lead.js";
import { extractWebsiteText } from "../utils/website.extractor.js";

dotenv.config();

mongoose.connect(process.env.MONGO_URI)
.then(() => {

console.log("Enrichment Worker Started");

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

    const text = await extractWebsiteText(website);

    if (!text) {
        console.log("No website content:", website);
        return;
    }

    console.log("Website text length:", text.length);

    /* SIMPLE HEURISTIC ANALYSIS (temporary before AI) */

    let businessType = "Medical Clinic";

    const services = [];

    if (text.toLowerCase().includes("dental")) {
        businessType = "Dental Clinic";
        services.push("Dental Care");
    }

    if (text.toLowerCase().includes("cardiology")) {
        services.push("Cardiology");
    }

    if (text.toLowerCase().includes("skin")) {
        services.push("Dermatology");
    }

    if (text.toLowerCase().includes("general physician")) {
        services.push("General Consultation");
    }

    /* EMAIL GUESS */

    let emailGuess = null;

    try {

      const domain = new URL(website).hostname.replace("www.", "");

      emailGuess = `info@${domain}`;

    } catch {}

    await Lead.updateOne(
      { website },
      {
        $set: {
          services,
          businessType,
          emailGuess,
          enriched: true
        }
      }
    );

    console.log("Lead enriched:", website);

},

{
connection: redisConnection,
concurrency: 5
}

);

})
.catch(err => console.log("MongoDB connection error:", err));