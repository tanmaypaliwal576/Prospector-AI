export const calculateLeadScore = (lead, textLength = 0) => {
  let score = 0;

  if (lead.website && !lead.website.startsWith("no-website")) score += 2;
  if (lead.description && lead.description.length > 30) score += 2;
  if (lead.services && lead.services.length > 1) score += 2;
  if (lead.phone) score += 1;
  if (textLength > 1000) score += 1;

  if (score >= 5) return "High";
  if (score >= 3) return "Medium";
  return "Low";
};