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
    enum: ["High", "Medium", "Low"],
    default: "Low"
  },

  enriched: {
    type: Boolean,
    default: false
  },

  enrichmentStatus: {
    type: String,
    enum: ["pending", "processing", "done", "failed"],
    default: "pending"
  }

},
{ timestamps: true }
);

export default mongoose.model("Lead", leadSchema);