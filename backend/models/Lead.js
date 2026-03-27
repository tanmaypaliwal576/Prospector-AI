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

  // ✅ ADD THESE ↓↓↓

  sourceQuery: String,        // "Dentists in Chicago"
  status: {
    type: String,
    enum: ["scraped", "enriched", "failed"],
    default: "scraped"
  }

},
{
  timestamps: true   // ✅ IMPORTANT
});

export default mongoose.model("Lead", leadSchema);