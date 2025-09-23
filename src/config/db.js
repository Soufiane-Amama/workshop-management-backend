// src/config/db.js
const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: process.env.MONGO_DB_NAME || "workshopsDB",
    });
    console.log("✅ MongoDB Connected");
  } catch (error) {
    console.error("❌ MongoDB Error:", error.message);
    process.exit(1);
  }

  mongoose.connection.on("connected", () => console.log("🔌 Mongoose connected"));
  mongoose.connection.on("disconnected", () => console.log("🪫 Mongoose disconnected"));
  mongoose.connection.on("error", (err) => console.error("⚠️ Mongoose error:", err));
};

module.exports = connectDB;