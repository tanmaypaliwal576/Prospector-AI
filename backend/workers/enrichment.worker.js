import { Worker } from "bullmq";
import { redisConnection } from "../redis/redis.connection.js";

import mongoose from "mongoose";
import dotenv from "dotenv";

import Lead from "../models/Lead.js";
import { extractWebsiteText } from "../utils/website.extractor.js";
import { lightExtract } from "../utils/light.extractor.js";

import { analyzeBatch } from "../services/gemini.service.js";
import { calculateLeadScore } from "../utils/leadScoring.js";

dotenv.config();

const BATCH_SIZE = 5;

// 🔥 BLOCKED DOMAINS
const BLOCKED_DOMAINS = [
  "marriott.com",
  "hyatt.com",
  "tajhotels.com",
  "radissonhotels.com",
  "itchotels.com",
  "seleqtionshotels.com",
  "booking.com",
  "makemytrip.com",
  "tripadvisor.com"
];

// 🔥 AGGREGATORS / JUNK
const BLOCKED_AGGREGATORS = [
  "linktr.ee",
  "all.accor.com",
  "bookmystay.io",
  "expedia.com",
  "goibibo.com",
  "agoda.com"
];

// 🔥 CLEAN URL
const cleanURL = (url) => {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return url;
  }
};

mongoose.connect(process.env.MONGO_URI)
.then(() => {

  console.log("🚀 Enrichment Worker Started (FINAL)");

  new Worker(
    "enrichmentQueue",

    async () => {

      console.log("📥 Enrichment job triggered");

      const leads = await Lead.find({
        enriched: false,
        enrichmentStatus: { $in: ["pending", "processing"] },
        website: { $exists: true }
      }).limit(BATCH_SIZE);

      if (leads.length === 0) {
        console.log("😴 No pending leads — idle");
        await new Promise(r => setTimeout(r, 15000));
        return;
      }

      console.log(`📦 Batch size: ${leads.length}`);

      const validLeads = [];
      const processedDomains = new Set();

      for (const lead of leads) {

        await Lead.updateOne(
          { _id: lead._id },
          { $set: { enrichmentStatus: "processing" } }
        );

        let website = lead.website;

        // ❌ Invalid
        if (!website || website.startsWith("no-website")) {
          console.log("🚫 Invalid website:", website);
          await Lead.updateOne({ _id: lead._id }, { $set: { enrichmentStatus: "failed" } });
          continue;
        }

        website = cleanURL(website);

        let domain;
        try {
          domain = new URL(website).hostname.replace("www.", "");
        } catch {
          continue;
        }

        // ❌ Duplicate
        if (processedDomains.has(domain)) {
          console.log("🔁 Duplicate skipped:", domain);
          await Lead.updateOne({ _id: lead._id }, { $set: { enrichmentStatus: "failed" } });
          continue;
        }
        processedDomains.add(domain);

        // ❌ Aggregator
        if (BLOCKED_AGGREGATORS.some(d => domain.includes(d))) {
          console.log("🚫 Aggregator skipped:", domain);
          await Lead.updateOne({ _id: lead._id }, { $set: { enrichmentStatus: "failed" } });
          continue;
        }

        // ❌ Heavy domain
        if (BLOCKED_DOMAINS.some(d => domain.includes(d))) {
          console.log("🚫 Heavy domain skipped:", domain);
          await Lead.updateOne({ _id: lead._id }, { $set: { enrichmentStatus: "failed" } });
          continue;
        }

        // 🔍 Extraction
        let text = await lightExtract(website);

        if (!text || text.length < 1000) {
          console.log("🔁 Fallback triggered:", website);

          text = await extractWebsiteText(website);

          if (!text || text.length < 1000) {
            await Lead.updateOne({ _id: lead._id }, { $set: { enrichmentStatus: "failed" } });
            continue;
          }
        }

        console.log("📄 Text length:", text.length);

        validLeads.push({ lead, text, website });
      }

      console.log(`✅ Valid leads: ${validLeads.length}`);
      if (validLeads.length === 0) return;

      try {

        const texts = validLeads.map(v => v.text);

        console.log("🚀 Sending batch to Gemini...");
        const results = await analyzeBatch(texts);

        if (!results) {
          console.log("❌ Gemini failed");
          return;
        }

        console.log(`✅ Batch processed (${results.length})`);

        const safeLength = Math.min(results.length, validLeads.length);

        for (let i = 0; i < safeLength; i++) {

          const { lead, text, website } = validLeads[i];
          const aiData = results[i];

          let emailGuess = null;
          try {
            const domain = new URL(website).hostname.replace("www.", "");
            emailGuess = `info@${domain}`;
          } catch {}

          const leadQuality = calculateLeadScore(
            { ...aiData, phone: lead.phone, emailGuess },
            text.length
          );

          await Lead.updateOne(
            { _id: lead._id },
            {
              $set: {
                services: aiData.services || [],
                businessType: aiData.businessType || null,
                description: aiData.description || null,
                ownerName: aiData.ownerName || null,
                emailGuess,
                leadQuality,
                enriched: true,
                enrichmentStatus: "done"
              }
            }
          );

          console.log(`✅ Enriched (${leadQuality}):`, website);
        }

        console.log("🎉 Batch completed");
        await new Promise(r => setTimeout(r, 5000));

      } catch (err) {
        if (err.message === "QUOTA_EXCEEDED") {
          console.log("🚫 Quota exceeded → sleeping");
          await new Promise(r => setTimeout(r, 24 * 60 * 60 * 1000));
        } else {
          console.log("❌ Error:", err.message);
        }
      }

    },

    {
      connection: redisConnection,
      concurrency: 1
    }
  );

})
.catch(err => console.log("MongoDB error:", err));