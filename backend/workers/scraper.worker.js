import { Worker } from "bullmq";
import { redisConnection } from "../redis/redis.connection.js";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import mongoose from "mongoose";
import dotenv from "dotenv";
import Lead from "../models/Lead.js";

dotenv.config();
puppeteer.use(StealthPlugin());

console.log("Starting Worker...");

mongoose.connect(process.env.MONGO_URI)
.then(() => {

  console.log("Worker MongoDB Connected");

  const worker = new Worker(
    "scraperQueue",

    async (job) => {

      const { query } = job.data;

      console.log("Searching Google Maps for:", query);

      const browser = await puppeteer.launch({
        headless: false,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled"
        ]
      });

      const page = await browser.newPage();

      await page.goto(
        `https://www.google.com/maps/search/${encodeURIComponent(query)}`,
        { waitUntil: "networkidle2", timeout: 60000 }
      );

      console.log("Maps loaded");

      await page.waitForSelector("a.hfpxzc", { timeout: 20000 });

      console.log("Business cards detected");

      /* SCROLL RESULTS */

      for (let i = 0; i < 15; i++) {

        await page.evaluate(() => {

          const scrollable = document.querySelector('div[role="feed"]');

          if (scrollable) scrollable.scrollBy(0, 3000);

        });

        await new Promise(r => setTimeout(r, 2000));
      }

      console.log("Scrolling finished");

      const businessLinks = await page.$$eval(
        "a.hfpxzc",
        links => links.slice(0, 50).map(el => el.href)
      );

      console.log("Businesses found:", businessLinks.length);

      const leads = [];

      for (const link of businessLinks) {

        const businessPage = await browser.newPage();

        try {

          await businessPage.goto(link, {
            waitUntil: "domcontentloaded",
            timeout: 30000
          });

          await businessPage.waitForSelector("h1", { timeout: 15000 });

          const name = await businessPage.$eval(
            "h1",
            el => el.innerText
          );

          const address = await businessPage.$eval(
            'button[data-item-id="address"]',
            el => el.innerText
          ).catch(() => null);

          const phone = await businessPage.$eval(
            'button[data-item-id^="phone"]',
            el => el.innerText
          ).catch(() => null);

          let website = await businessPage.$eval(
            'a[data-item-id="authority"]',
            el => el.href
          ).catch(() => null);

          if (!website) {
            website = await businessPage.$eval(
              'a[aria-label^="Website"]',
              el => el.href
            ).catch(() => null);
          }

          const lead = {
            name,
            address,
            phone,
            website
          };

          leads.push(lead);

          console.log("Lead:", lead);

        } catch (err) {

          console.log("Failed to extract business");

        }

        await businessPage.close();
      }

      /* SAVE TO DATABASE SAFELY */

      for (const lead of leads) {

        if (lead.website) {

          await Lead.updateOne(
            { website: lead.website },
            { $set: lead },
            { upsert: true }
          );

        } else {

          const uniqueKey = `no-website-${Date.now()}-${Math.random()}`;

          await Lead.create({
            ...lead,
            website: uniqueKey
          });

        }

      }

      console.log("Saved leads:", leads.length);

      await browser.close();

      return leads;

    },

    {
      connection: redisConnection,
      concurrency: 2
    }
  );

  worker.on("completed", job => {
    console.log(`Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.log(`Job ${job.id} failed`, err);
  });

})
.catch(err => console.log("MongoDB connection error:", err));