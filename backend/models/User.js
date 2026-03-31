import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
{
  username: {
    type: String,
    default: "admin"
  },
  credits: {
    type: Number,
    default: 100 // Starting free credits
  }
},
{
  timestamps: true
});

export default mongoose.model("User", userSchema);
