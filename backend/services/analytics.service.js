import Lead from "../models/Lead.js";

export const getSummaryAnalytics = async () => {
  const [totalLeads, qualityStats, businessTypeStats, avgRating] =
    await Promise.all([
      Lead.countDocuments(),
      Lead.aggregate([
        {
          $group: {
            _id: "$leadQuality",
            count: { $sum: 1 },
          },
        },
      ]),
      Lead.aggregate([
        {
          $group: {
            _id: "$businessType",
            count: { $sum: 1 },
          },
        },
      ]),
      Lead.aggregate([
        {
          $match: {
            rating: { $type: "number" },
          },
        },
        {
          $group: {
            _id: null,
            avgRating: { $avg: "$rating" },
          },
        },
      ]),
    ]);

  return {
    totalLeads,
    qualityStats,
    businessTypeStats,
    avgRating: avgRating[0]?.avgRating || 0,
  };
};