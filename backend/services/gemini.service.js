import dotenv from "dotenv";
dotenv.config();

import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("❌ GEMINI_API_KEY not found");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

export const analyzeBusiness = async (text, retries = 2) => {

  try {

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash"
    });

    const prompt = `
You analyze a business website.

Extract structured information.

Return ONLY JSON.

Example:
{
 "businessType": "Hotel",
 "services": ["Hotel rooms","Restaurant"],
 "description": "Hotel offering accommodation."
}

Rules:
- Only JSON
- No explanations
- No markdown

Website text:
${text.slice(0,15000)}
`;

    const result = await model.generateContent(prompt);

    const response = await result.response;
    const content = response.text();

    const match = content.match(/\{[\s\S]*\}/);

    if (!match) {
      console.log("Gemini returned invalid JSON");
      return null;
    }

    const json = JSON.parse(match[0]);

    return {
      businessType: json.businessType || "Business",
      services: json.services || [],
      description: json.description || ""
    };

  } catch (error) {

    const msg = error?.message || "";

    /* DAILY QUOTA REACHED */

    if (msg.includes("Quota exceeded")) {

      console.log("🚫 Gemini daily quota reached. Skipping AI enrichment.");

      return null;
    }

    /* TEMPORARY RATE LIMIT */

    if (msg.includes("429") && retries > 0) {

      console.log("⚠️ Rate limit hit. Waiting 20 seconds...");

      await new Promise(r => setTimeout(r, 20000));

      return analyzeBusiness(text, retries - 1);
    }

    console.log("Gemini extraction error:", msg);

    return null;
  }

};