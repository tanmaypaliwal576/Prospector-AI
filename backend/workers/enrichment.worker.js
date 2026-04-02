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

    const badDomains = [
      "booking.com",
      "facebook.com",
      "instagram.com",
      "tripadvisor.com",
      "bit.ly",
      "justdial.com"
    ];

    /* =========================
       PROCESS BATCH
    ========================= */
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

        console.log(`🤖 Batch ${batchNumber} → Sending to Gemini`);

        const results = await analyzeBatch(texts);

        console.log(`✅ Batch ${batchNumber} → Gemini response received`);

        for (let i = 0; i < currentBatch.length; i++) {

          const { lead, text, jobId } = currentBatch[i];
          const aiData = results?.[i];

          if (!aiData) {
            console.log(`⚠️ Missing AI data`);
            const fallbackScore = calculateLeadScore(
              { phone: lead.phone, website: lead.website },
              text.length
            );
            await Lead.updateOne(
              { _id: lead._id },
              {
                $set: {
                  leadQuality: fallbackScore,
                  enriched: true,
                  enrichmentStatus: "done",
                  status: "enriched"
                }
              }
            );
            if (jobId) await redisConnection.incr(`enrichment:${jobId}:done`);
            continue;
          }

          let emailGuess = null;

          try {
            const domain = new URL(lead.website).hostname.replace("www.", "");
            emailGuess = `info@${domain}`;
          } catch {}

          const score = calculateLeadScore(
            { ...aiData, phone: lead.phone, emailGuess, website: lead.website },
            text.length
          );

          console.log(`📊 Lead: ${lead.website} → Score: ${score} phone : ${lead.phone}`);

          // 🔥 FINAL UPDATE (FIXED)
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
                enrichmentStatus: "done",
                status: "enriched" // 🔥 CRITICAL FIX
              }
            }
          );

          console.log(`✅ Enriched (${score}) → ${lead.website}`);
          if (jobId) await redisConnection.incr(`enrichment:${jobId}:done`);
        }

        console.log(`🎉 Batch ${batchNumber} COMPLETED\n`);

      } catch (err) {

        if (err.message === "QUOTA_EXCEEDED") {

          console.log(`🚫 QUOTA EXCEEDED`);

          for (const item of currentBatch) {
            await Lead.updateOne(
              { _id: item.lead._id },
              {
                $set: {
                  enriched: false,
                  enrichmentStatus: "skipped_quota",
                  status: "failed" // 🔥 FIX
                }
              }
            );
            if (item.jobId) await redisConnection.incr(`enrichment:${item.jobId}:done`);
          }

        } else {
          console.log(`❌ Batch error:`, err.message);
        }
      }

      isProcessing = false;

      if (batch.length > 0) {
        processBatch().catch(console.error);
      }
    };

    /* =========================
       WORKER
    ========================= */
    new Worker(
      "enrichmentQueue",

      async (job) => {

        const { leadId, jobId } = job.data;

        const lead = await Lead.findById(leadId);

        if (!lead || !lead.website) {
          if (jobId) await redisConnection.incr(`enrichment:${jobId}:done`);
          return;
        }

        // 🔥 Skip already enriched
        if (lead.status === "enriched") {
          console.log("⏭️ Already enriched:", lead.website);
          if (jobId) await redisConnection.incr(`enrichment:${jobId}:done`);
          return;
        }

        if (lead.enrichmentStatus === "skipped_quota") {
          console.log("⏭️ Skipped (quota):", lead.website);
          if (jobId) await redisConnection.incr(`enrichment:${jobId}:done`);
          return;
        }

        if (seenWebsites.has(lead.website)) {
          console.log("♻️ Duplicate skipped:", lead.website);
          if (jobId) await redisConnection.incr(`enrichment:${jobId}:done`);
          return;
        }

        if (badDomains.some(d => lead.website.includes(d))) {
          console.log("🚫 Aggregator skipped:", lead.website);
          const score = calculateLeadScore({ phone: lead.phone, website: lead.website }, 0);
          await Lead.updateOne({ _id: lead._id }, {
              $set: { leadQuality: score, enriched: true, enrichmentStatus: "done", status: "enriched" }
          });
          if (jobId) await redisConnection.incr(`enrichment:${jobId}:done`);
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
          if (jobId) await redisConnection.incr(`enrichment:${jobId}:done`);
          return;
        }

        if (!text || text.length < 1500) {
          console.log("❌ Low content, bypassing Gemini, scoring manually");
          const score = calculateLeadScore({ phone: lead.phone, website: lead.website }, text?.length || 0);
          await Lead.updateOne(
            { _id: lead._id },
            {
              $set: {
                leadQuality: score,
                enriched: true,
                enrichmentStatus: "done",
                status: "enriched"
              }
            }
          );
          if (jobId) await redisConnection.incr(`enrichment:${jobId}:done`);
          return;
        }

        text = text.slice(0, 3000);

        console.log(`✅ Valid (${text.length} chars)`);

        batch.push({ lead, text, jobId });
        console.log(`📦 Batch size: ${batch.length}/${BATCH_SIZE}`);

        if (batch.length >= BATCH_SIZE) {
          if (!isProcessing) {
            await processBatch();
          } else {
            // Apply backpressure so worker stops pulling from Redis while waiting
            while (isProcessing) {
              await new Promise(r => setTimeout(r, 500));
            }
            if (batch.length >= BATCH_SIZE && !isProcessing) {
              await processBatch();
            }
          }
        }

      },

      {
        connection: redisConnection,
        concurrency: 2
      }
    );

    /* =========================
       AUTO FLUSH
    ========================= */
    setInterval(async () => {
      if (batch.length > 0 && !isProcessing) {
        console.log("⏳ Flushing remaining batch...");
        await processBatch();
      }
    }, 10000);

    /* =========================
       HEARTBEAT
    ========================= */
    setInterval(() => {
      console.log("🟢 Worker alive...");
    }, 15000);

  })
  .catch(err => console.log("❌ Mongo error:", err));