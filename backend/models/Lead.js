import mongoose from "mongoose";

const leadSchema = new mongoose.Schema(
{
  name: String,

  website: {
    type: String,
    unique: true,
    sparse: true
  },

  address: String,
  phone: String,

  rating: Number,
  reviews: Number,

  services: {
    type: [String],
    default: []
  },

  businessType: String,
  description: String,

  ownerName: String,
  emailGuess: String,

  leadQuality: {
    type: String,
    enum: ["High", "Medium", "Low"],
    default: null
  },

  sourceQuery: String,

  // 🔥 CORE STATUS (IMPORTANT)
  status: {
    type: String,
    enum: ["scraped", "enriched", "failed"],
    default: "scraped"
  },

  // 🔥 ENRICHMENT FLAGS
  enriched: {
    type: Boolean,
    default: false
  },

  enrichmentStatus: {
    type: String,
    enum: ["pending", "done", "skipped_quota"],
    default: "pending"
  }

},
{
  timestamps: true
});

/* =========================
   INDEXES (PERFORMANCE)
========================= */

// ❌ DO NOT duplicate website index (already unique)
leadSchema.index({ leadQuality: 1 });
leadSchema.index({ businessType: 1 });
leadSchema.index({ rating: 1 });
leadSchema.index({ createdAt: -1 });
leadSchema.index({ sourceQuery: 1 });
leadSchema.index({ status: 1 });

export default mongoose.model("Lead", leadSchema);