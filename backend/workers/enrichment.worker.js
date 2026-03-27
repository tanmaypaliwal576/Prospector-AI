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

console.log("🚀 [ENRICHMENT] Worker Booting...");

mongoose.connect(process.env.MONGO_URI)
  .then(() => {

    console.log("✅ [ENRICHMENT] MongoDB Connected");

    let batch = [];
    let batchCounter = 1;
    let isProcessing = false;

    const BATCH_SIZE = 3;

    const seenWebsites = new Set();

    // 🔥 BAD DOMAINS FILTER
    const badDomains = [
      "booking.com",
      "facebook.com",
      "instagram.com",
      "tripadvisor.com",
      "bit.ly",
      "justdial.com"
    ];

    // =========================
    // 🔥 PROCESS BATCH
    // =========================
    const processBatch = async () => {

      if (isProcessing) return;
      if (batch.length === 0) return;

      isProcessing = true;

      const currentBatch = batch.slice(0, BATCH_SIZE);
      batch = batch.slice(BATCH_SIZE);

      const batchNumber = batchCounter++;

      console.log("\n==============================");
      console.log(`📦 Batch ${batchNumber} READY (${currentBatch.length} leads)`);
      console.log("==============================");

      const texts = currentBatch.map(b => b.text);

      try {

        console.log(`🤖 Batch ${batchNumber} → Sending to Gemini (${texts.length} leads)`);

        const results = await analyzeBatch(texts);

        console.log(`✅ Batch ${batchNumber} → Gemini response received`);

        for (let i = 0; i < currentBatch.length; i++) {

          const { lead, text } = currentBatch[i];
          const aiData = results?.[i];

          if (!aiData) {
            console.log(`⚠️ Batch ${batchNumber} → Missing AI data`);
            continue;
          }

          let emailGuess = null;

          try {
            const domain = new URL(lead.website).hostname.replace("www.", "");
            emailGuess = `info@${domain}`;
          } catch {}

          const score = calculateLeadScore(
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
                leadQuality: score,
                enriched: true,
                enrichmentStatus: "done"
              }
            }
          );

          console.log(`✅ Batch ${batchNumber} → Enriched (${score}) → ${lead.website}`);
        }

        console.log(`🎉 Batch ${batchNumber} COMPLETED\n`);

      } catch (err) {

        if (err.message === "QUOTA_EXCEEDED") {

          console.log(`🚫 Batch ${batchNumber} → QUOTA EXCEEDED`);

          for (const item of currentBatch) {
            await Lead.updateOne(
              { _id: item.lead._id },
              {
                $set: {
                  enriched: false,
                  enrichmentStatus: "skipped_quota"
                }
              }
            );
          }

          console.log(`🛑 Batch ${batchNumber} stopped due to quota\n`);
        } else {
          console.log(`❌ Batch ${batchNumber} error:`, err.message);
        }
      }

      isProcessing = false;

      if (batch.length >= BATCH_SIZE) {
        await processBatch();
      }
    };

    // =========================
    // 🔥 WORKER
    // =========================
    new Worker(
      "enrichmentQueue",

      async (job) => {

        const { leadId } = job.data;

        const lead = await Lead.findById(leadId);

        if (!lead || !lead.website) return;

        // 🔥 SKIP DUPLICATES
        if (lead.enriched === true) {
          console.log("⏭️ Already enriched:", lead.website);
          return;
        }

        if (lead.enrichmentStatus === "skipped_quota") {
          console.log("⏭️ Skipped earlier (quota):", lead.website);
          return;
        }

        if (seenWebsites.has(lead.website)) {
          console.log("♻️ Duplicate skipped:", lead.website);
          return;
        }

        // 🔥 BAD DOMAIN FILTER
        if (badDomains.some(d => lead.website.includes(d))) {
          console.log("🚫 Skipped aggregator:", lead.website);
          return;
        }

        seenWebsites.add(lead.website);

        console.log(`\n📥 Processing → ${lead.website}`);

        let text;

        try {

          text = await lightExtract(lead.website);

          if (!text || text.length < 1500) {
            console.log("🔁 Using fallback extractor...");
            text = await extractWebsiteText(lead.website);
          }

        } catch (err) {
          console.log("❌ Extraction failed:", err.message);
          return;
        }

        // 🔥 FINAL FILTER
        if (!text || text.length < 1500) {
          console.log("❌ Skipped (low content):", lead.website);
          return;
        }

        text = text.slice(0, 3000);

        console.log(`✅ Valid (${text.length} chars)`);

        // 🔥 SAFE PUSH
        if (batch.length < BATCH_SIZE) {
          batch.push({ lead, text });
          console.log(`📦 Current batch size: ${batch.length}/${BATCH_SIZE}`);
        } else {
          console.log("⏳ Batch full → waiting");
          return;
        }

        if (batch.length === BATCH_SIZE) {
          await processBatch();
        }

      },

      {
        connection: redisConnection,
        concurrency: 2
      }
    );

    // 🔥 AUTO FLUSH
    setInterval(async () => {
      if (batch.length > 0 && !isProcessing) {
        console.log("⏳ Flushing remaining batch...");
        await processBatch();
      }
    }, 10000);

    // 🔥 HEARTBEAT
    setInterval(() => {
      console.log("🟢 Worker alive... waiting for jobs");
    }, 15000);

  })
  .catch(err => console.log("❌ Mongo error:", err));