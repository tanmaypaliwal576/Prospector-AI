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

    /* AI ENRICHMENT FIELDS */

    services: [String],
    businessType: String,
    description: String,
    emailGuess: String,

    /* LEAD SCORING (Week 4) */

    score: Number,

    leadQuality: {
        type: String,
        enum: ["High", "Medium", "Low"]
    },

    /* ENRICHMENT STATUS */

    enriched: {
        type: Boolean,
        default: false
    }

},
{ timestamps: true }
);

const Lead = mongoose.model("Lead", leadSchema);

export default Lead;