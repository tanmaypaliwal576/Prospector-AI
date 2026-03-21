import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

console.log("🔥 USING GEMINI SERVICE v2");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function analyzeBusiness(text) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `
You are a business analyst.

Extract structured business data from the following website content.

Return ONLY valid JSON. No explanation. No markdown.

Format:
{
  "businessType": "",
  "services": [],
  "description": "",
  "ownerName": ""
}

Website Content:
${text.slice(0, 12000)}
`;

    const result = await model.generateContent(prompt);

    const raw = result?.response?.text?.();

    if (!raw) {
      console.log("❌ Empty Gemini response");
      return null;
    }

    const clean = raw
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    let parsed;

    try {
      parsed = JSON.parse(clean);
    } catch (err) {
      console.log("❌ Invalid JSON from Gemini");
      console.log("RAW:", raw);
      return null;
    }

    return {
      businessType: parsed.businessType || null,
      services: Array.isArray(parsed.services) ? parsed.services : [],
      description: parsed.description || null,
      ownerName: parsed.ownerName || null
    };

  } catch (err) {
    console.log("❌ Gemini error:", err);

    if (err.message?.toLowerCase().includes("quota")) {
      throw new Error("QUOTA_EXCEEDED");
    }

    return null;
  }
}