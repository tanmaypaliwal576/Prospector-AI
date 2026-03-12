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
    emailGuess: String,

    score: Number,

    leadQuality: {
        type: String,
        enum: ["High", "Medium", "Low"]
    },

    enriched: {
        type: Boolean,
        default: false
    }

},
{ timestamps: true }
);

const Lead = mongoose.model("Lead", leadSchema);

export default Lead;