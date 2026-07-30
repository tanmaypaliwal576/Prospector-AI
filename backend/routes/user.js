import express from "express";
import User from "../models/User.js";

const router = express.Router();

// Get the default admin user's credits
router.get("/credits", async (req, res) => {
  try {
    let user = await User.findOne({ username: "admin" });
    if (!user) {
      user = await User.create({ username: "admin", credits: 100 });
    }
    
    res.json({
      success: true,
      credits: user.credits
    });
  } catch (error) {
    console.error("Fetch credits error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Recharge credits endpoint
router.post("/recharge", async (req, res) => {
  try {
    let user = await User.findOne({ username: "admin" });
    if (!user) {
      user = await User.create({ username: "admin", credits: 100 });
    } else {
      user.credits += 100;
      await user.save();
    }
    res.json({
      success: true,
      credits: user.credits,
      message: "100 Credits added successfully!"
    });
  } catch (error) {
    console.error("Recharge credits error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

export default router;
