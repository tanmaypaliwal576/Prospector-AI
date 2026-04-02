import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();


const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function analyzeBatch(texts) {
  try {

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash"
    });

    const prompt = `
Return EXACTLY ${texts.length} objects in JSON ARRAY.

[
  {
    "businessType": "",
    "services": [],
    "description": "",
    "ownerName": ""
  }
]

STRICT RULES:
- Array length MUST be ${texts.length}
- Do NOT skip items
- Do NOT merge responses
- No explanation
- Valid JSON only

Analyze:

${texts.map((t, i) => `${i + 1}. ${t.slice(0, 3500)}`).join("\n")}
`;

    const result = await model.generateContent(prompt);
    const raw = result?.response?.text?.();

    if (!raw) return null;

    const clean = raw
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    return JSON.parse(clean);

  } catch (err) {

    if (err.message?.toLowerCase().includes("quota")) {
      throw new Error("QUOTA_EXCEEDED");
    }

    console.log("❌ Gemini error:", err.message);
    return null;
  }
}