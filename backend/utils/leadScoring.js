export function calculateLeadScore(data, textLength) {

  let score = 0;

  if (data.phone) score += 2;
  if (data.emailGuess) score += 2;

  if (data.services && data.services.length >= 3) score += 2;
  if (data.description && data.description.length > 80) score += 1;

  if (textLength > 5000) score += 2;
  else if (textLength > 2500) score += 1;

  if (!data.services || data.services.length === 0) score -= 1;

  if (score >= 5) return "High";
  if (score >= 3) return "Medium";
  return "Low";
}