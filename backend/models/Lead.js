import mongoose from "mongoose";

const leadSchema = new mongoose.Schema(
{
    name: String,
    address: String,
    phone: String,
   website: {
 type: String,
 unique: true,
 sparse: true
},
    rating: Number,
    reviews: Number,

    services: [String],
    businessType: String,
    emailGuess: String,

    score: Number,
    leadQuality: {
        type: String,
        enum: ["High", "Medium", "Low"]
    }
},
{ timestamps: true }
);

export default mongoose.model("Lead", leadSchema);