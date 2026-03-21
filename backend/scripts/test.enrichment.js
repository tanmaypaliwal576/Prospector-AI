import mongoose from "mongoose";
import dotenv from "dotenv";

import { extractWebsiteText } from "../utils/website.extractor.js";
import { analyzeBusiness } from "../services/gemini.service.js";

dotenv.config();

const TEST_SITES = [
  "https://www.tajhotels.com/",
  "https://www.oyo.com/",
  "https://www.marriott.com/",
  "https://www.dominos.co.in/",
  "https://www.zomato.com/",
  "https://www.flipkart.com/",
  "https://www.reliancejio.com/",
  "https://www.infosys.com/",
  "https://www.hdfcbank.com/",
  "https://www.airindia.com/"
];

const runTest = async () => {

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Mongo Connected for Testing");

  for (const site of TEST_SITES) {

    console.log("\n==============================");
    console.log("Testing:", site);

    try {

      const text = await extractWebsiteText(site);

      if (!text || text.length < 500) {
        console.log("Low content → skipped");
        continue;
      }

      console.log("Text length:", text.length);

      const aiData = await analyzeBusiness(text);

      console.log("AI OUTPUT:");
      console.log(JSON.stringify(aiData, null, 2));

    } catch (err) {
      console.log("Error:", err.message);
    }

  }

  process.exit();

};

runTest();