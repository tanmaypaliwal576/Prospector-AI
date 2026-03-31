import { Worker } from "bullmq";
import { redisConnection } from "../redis/redis.connection.js";
import { enrichmentQueue } from "../queues/enrichment.queue.js";

import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

import mongoose from "mongoose";
import dotenv from "dotenv";

import Lead from "../models/Lead.js";
import User from "../models/User.js";

dotenv.config();
puppeteer.use(StealthPlugin());

console.log("🚀 [SCRAPER] Worker Booting...");

mongoose.connect(process.env.MONGO_URI)
  .then(() => {

    console.log("✅ [SCRAPER] MongoDB Connected");

    new Worker(
      "scraperQueue",

      async (job) => {

        const { query } = job.data;
        const jobId = job.id;

        console.log(`\n==============================`);
        console.log(`🔍 [SCRAPER] JOB STARTED → ${query}`);
        console.log(`🆔 Job ID: ${jobId}`);
        console.log(`==============================\n`);

        let user = await User.findOne({ username: "admin" });
        if (!user) {
          user = await User.create({ username: "admin", credits: 100 });
        }

        if (user.credits <= 0) {
          console.log("❌ [SCRAPER] Out of credits. Stopping job.");
          return;
        }

        const browser = await puppeteer.launch({
          headless: false,
          args: ["--no-sandbox", "--disable-setuid-sandbox"]
        });

        let batch = [];
        const BATCH_SIZE = 10;

        // =========================
        // 🔥 SAFE BATCH PROCESSOR
        // =========================
        const processBatch = async (batchData) => {

          if (batchData.length === 0) return;

          console.log("💾 [SCRAPER] Saving batch...");

          try {

            // 🔥 DEDUPE
            const uniqueMap = new Map();

            for (const l of batchData) {
              if (l.website) {
                uniqueMap.set(l.website, l);
              } else {
                const key = `no-${Math.random()}`;
                uniqueMap.set(key, l);
              }
            }

            const uniqueBatch = Array.from(uniqueMap.values());

            const saved = await Promise.all(
              uniqueBatch.map(async (l) => {

                if (l.website) {
                  return await Lead.findOneAndUpdate(
                    { website: l.website },
                    {
                      $set: {
                        ...l,
                        enriched: false,
                        enrichmentStatus: "pending"
                      }
                    },
                    { upsert: true, returnDocument: "after" }
                  );
                } else {
                  return await Lead.create({
                    ...l,
                    website: `no-website-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
                  });
                }
              })
            );

            console.log(`✅ [SCRAPER] Batch saved (${saved.length})`);

            // 🔥 FILTER VALID
            const valid = saved.filter(
              l => l.website && !l.website.startsWith("no-website")
            );

            console.log(`📤 [SCRAPER] Sending ${valid.length} leads to enrichment`);

            await Promise.all(
              valid.map(l =>
                enrichmentQueue.add("enrich", { leadId: l._id }, {
                  attempts: 3,
                  backoff: { type: "exponential", delay: 30000 }
                })
              )
            );

            // 🔥 DEDUCT CREDITS
            if (valid.length > 0) {
              await User.updateOne({ username: "admin" }, { $inc: { credits: -valid.length } });
              console.log(`💸 Deducted ${valid.length} credits.`);
            }

            console.log("🚀 [SCRAPER] Batch pushed\n");

          } catch (err) {
            console.log("❌ [SCRAPER] Batch error:", err.message);
          }
        };

        try {

          const page = await browser.newPage();

          await page.goto(
            `https://www.google.com/maps/search/${encodeURIComponent(query)}`,
            { waitUntil: "networkidle2", timeout: 60000 }
          );

          await page.waitForSelector("a.hfpxzc");

          for (let i = 0; i < 15; i++) {
            await page.evaluate(() => {
              const el = document.querySelector('div[role="feed"]');
              if (el) el.scrollBy(0, 3000);
            });
            await new Promise(r => setTimeout(r, 1500));
          }

          let links = await page.$$eval(
            "a.hfpxzc",
            els => els.slice(0, 50).map(e => e.href)
          );

          user = await User.findOne({ username: "admin" });
          if (links.length > user.credits) {
            console.log(`⚠️ User only has ${user.credits} credits. Limiting links from ${links.length} to ${user.credits}.`);
            links = links.slice(0, user.credits);
          }

          console.log(`📊 [SCRAPER] Total links: ${links.length}`);

          await redisConnection.set(`scrape:${jobId}:total`, links.length);
          await redisConnection.set(`scrape:${jobId}:done`, 0);

          let count = 0;

          for (const link of links) {

            const p = await browser.newPage();

            try {

              await p.goto(link, { timeout: 30000 });
              await p.waitForSelector("h1");

              const name = await p.$eval("h1", el => el.innerText);

              const address = await p.$eval(
                'button[data-item-id="address"]',
                el => el.innerText
              ).catch(() => null);

              const phone = await p.$eval(
                'button[data-item-id^="phone"]',
                el => el.innerText
              ).catch(() => null);

              let website = await p.$eval(
                'a[data-item-id="authority"]',
                el => el.href
              ).catch(() => null);

              if (!website) {
                website = await p.$eval(
                  'a[aria-label^="Website"]',
                  el => el.href
                ).catch(() => null);
              }

              console.log(`📌 ${name}`);
              console.log(`🌐 ${website || "NONE"}`);

              batch.push({ name, address, phone, website });
              count++;

              console.log(`📦 Batch size: ${batch.length}/${BATCH_SIZE}`);

              // 🔥 PROCESS EXACT BATCH
              if (batch.length === BATCH_SIZE) {
                const currentBatch = [...batch];
                batch = []; // 🔥 RESET FIRST (IMPORTANT)
                await processBatch(currentBatch);
              }

            } catch (err) {
              console.log("❌ Extraction failed:", err.message);
            } finally {
              await p.close();
              await redisConnection.incr(`scrape:${jobId}:done`);
            }
          }

          // 🔥 FINAL BATCH
          if (batch.length > 0) {
            console.log("\n📦 Processing FINAL batch...");
            const finalBatch = [...batch];
            batch = [];
            await processBatch(finalBatch);
          }

          console.log("\n🎉 [SCRAPER] JOB COMPLETED\n");

        } catch (err) {
          console.log("❌ [SCRAPER] Fatal:", err.message);
        } finally {
          await browser.close();
          console.log("🧹 [SCRAPER] Browser closed\n");
        }
      },

      { connection: redisConnection, concurrency: 2 }
    );

  })
  .catch(err => console.log("❌ Mongo error:", err));