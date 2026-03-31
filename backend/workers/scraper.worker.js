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
          console.log("❌ [SCRAPER] No credits. Job stopped.");
          return;
        }

        const browser = await puppeteer.launch({
          headless: false,
          args: ["--no-sandbox", "--disable-setuid-sandbox"]
        });

        let batch = [];
        const BATCH_SIZE = 1; // Real-time processing

        // =========================
        // 🔥 PROCESS BATCH
        // =========================
        const processBatch = async (batchData) => {

          if (batchData.length === 0) return;

          // 🔴 CHECK CREDITS BEFORE PROCESSING
          user = await User.findOne({ username: "admin" });

          if (user.credits <= 0) {
            console.log("❌ Out of credits. Stopping batch.");
            return false; // signal stop
          }

          console.log("💾 [SCRAPER] Saving batch...");

          try {

            const uniqueMap = new Map();

            for (const l of batchData) {
              const key = l.website || `no-${Math.random()}`;
              uniqueMap.set(key, l);
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

            const valid = saved.filter(
              l => l.website && !l.website.startsWith("no-website")
            );

            console.log(`📤 Sending ${valid.length} to enrichment`);

            await Promise.all(
              valid.map(l =>
                enrichmentQueue.add("enrich", { leadId: l._id })
              )
            );

            // 🔥 DEDUCT CREDITS SAFELY
            const deductAmount = valid.length;

            user = await User.findOne({ username: "admin" });

            if (user.credits < deductAmount) {
              console.log("❌ Not enough credits for this batch.");
              return false;
            }

            user.credits -= deductAmount;
            await user.save();

            console.log(`💳 Credits left: ${user.credits}`);

            return true;

          } catch (err) {
            console.log("❌ Batch error:", err.message);
            return true;
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

          const links = await page.$$eval(
            "a.hfpxzc",
            els => els.slice(0, 50).map(e => e.href)
          );

          console.log(`📊 Total links: ${links.length}`);

          await redisConnection.set(`scrape:${jobId}:total`, links.length);
          await redisConnection.set(`scrape:${jobId}:done`, 0);

          for (const link of links) {

            const p = await browser.newPage();

            try {

              user = await User.findOne({ username: "admin" });

              if (user.credits <= 0) {
                console.log("❌ Credits exhausted. Stopping scraping.");
                break;
              }

              await p.goto(link, { timeout: 30000 });
              await p.waitForSelector("h1");

              const name = await p.$eval("h1", el => el.innerText);

              let address = await p.$eval(
                'button[data-item-id="address"]',
                el => el.innerText
              ).catch(() => null);
              if (address) address = address.replace(/[\u200B-\u200F\u202A-\u202E\uE000-\uF8FF\uFFFD]/g, "").replace(/[^\p{L}\p{N}\p{P}\p{Z}+=]/gu, "").trim();

              let phone = await p.$eval(
                'button[data-item-id^="phone"]',
                el => el.innerText
              ).catch(() => null);
              if (phone) phone = phone.replace(/[^\d+\-\s()]/g, "").trim();

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

              batch.push({ name, address, phone, website });

              if (batch.length === BATCH_SIZE) {
                const currentBatch = [...batch];
                batch = [];

                const shouldContinue = await processBatch(currentBatch);

                if (!shouldContinue) break;
              }

            } catch (err) {
              console.log("❌ Extraction failed:", err.message);
            } finally {
              await p.close();
              await redisConnection.incr(`scrape:${jobId}:done`);
            }
          }

          // FINAL BATCH
          if (batch.length > 0) {
            const shouldContinue = await processBatch(batch);
            batch = [];

            if (!shouldContinue) {
              console.log("❌ Final batch skipped due to credits.");
            }
          }

          console.log("🎉 JOB COMPLETED");

        } catch (err) {
          console.log("❌ Fatal:", err.message);
        } finally {
          await browser.close();
          console.log("🧹 Browser closed\n");
        }
      },

      { connection: redisConnection, concurrency: 2 }
    );

  })
  .catch(err => console.log("❌ Mongo error:", err));