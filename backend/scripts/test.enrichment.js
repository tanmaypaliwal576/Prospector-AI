import mongoose from "mongoose";
import dotenv from "dotenv";

import { extractWebsiteText } from "../utils/website.extractor.js";
import { analyzeBatch } from "../services/gemini.service.js";

dotenv.config();

// 🔥 USE REAL DOMAIN-SPECIFIC SITES (IMPORTANT)
const TEST_SITES = [
  "http://aarogyasmiles.com",
  "http://www.baridental.in",
  "http://www.smileudent.com",
  "http://www.hotelgoldennest.com",
  "http://www.hotelspencer.in",
  "http://www.saisagarhotel.in",
  "http://www.vistainn.in",
  "http://hotelratnapalace.com"
];

const runTest = async () => {

  await mongoose.connect(process.env.MONGO_URI);
  console.log("🟢 Mongo Connected for Testing\n");

  for (const site of TEST_SITES) {

    console.log("\n==============================");
    console.log("🌐 Testing:", site);

    try {

      const text = await extractWebsiteText(site);

      if (!text || text.length < 500) {
        console.log("⛔ Low content → skipped");
        continue;
      }

      console.log("📄 Text length:", text.length);

      // 🔥 IMPORTANT: use batch (even for single input)
      const results = await analyzeBatch([text]);

      if (!results || results.length === 0) {
        console.log("❌ AI returned no result");
        continue;
      }

      const aiData = results[0];

      console.log("\n🤖 AI OUTPUT:");
      console.log(JSON.stringify(aiData, null, 2));

      console.log("\n🧠 Manual Check:");
      console.log("→ Verify services match website");
      console.log("→ Verify business type is correct");
      console.log("→ Verify description is relevant");

    } catch (err) {
      console.log("❌ Error:", err.message);
    }

  }

  console.log("\n✅ Testing Completed");
  process.exit();

};

runTest();