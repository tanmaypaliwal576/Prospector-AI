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

  services: [String],
  businessType: String,
  description: String,

  ownerName: String,
  emailGuess: String,

  leadQuality: {
    type: String,
    enum: ["High", "Medium", "Low"]
  },

  sourceQuery: String,

  status: {
    type: String,
    enum: ["scraped", "enriched", "failed"],
    default: "scraped"
  }

},
{
  timestamps: true
}
);

/* 🔥 INDEXES (CRITICAL) */
leadSchema.index({ leadQuality: 1 });
leadSchema.index({ businessType: 1 });
leadSchema.index({ rating: 1 });
leadSchema.index({ createdAt: -1 });
leadSchema.index({ sourceQuery: 1 });

export default mongoose.model("Lead", leadSchema);