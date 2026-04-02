export function calculateLeadScore(data, textLength = 0) {
  const hasPhone = !!data.phone;
  const hasWebsite = !!(data.website && !data.website.includes("no-website"));
  const hasDescription = !!(data.description && data.description.length > 10);

  if (hasPhone && hasWebsite && hasDescription) {
    return "High";
  }

  // Make scoring more forgiving to reduce excessive "Low" leads
  if (hasPhone || hasWebsite) {
    return "Medium";
  }

  return "Low";
}