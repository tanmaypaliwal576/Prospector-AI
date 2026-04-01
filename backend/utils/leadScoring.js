export function calculateLeadScore(data, textLength) {
  let score = 0;

  // 🔥 Core signals (most reliable)
  if (data.phone) score += 2;

  if (data.rating >= 4) score += 2;
  else if (data.rating >= 3.5) score += 1;

  if (data.reviews >= 100) score += 2;
  else if (data.reviews >= 20) score += 1;

  // ⚠️ Website (less strict now)
  if (data.website && !data.website.includes("no-website")) {
    score += 1;
  }

  // 📄 Content quality (relaxed)
  if (data.description && data.description.length > 25) {
    score += 1;
  }

  if (textLength > 800) {
    score += 1;
  }

  // 🎯 Final classification (adjusted)
  if (score >= 2) return "High";
  if (score >= 1) return "Medium";
  return "Basic";
}