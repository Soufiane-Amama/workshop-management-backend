// src/app.js
const express = require("express");
const cors = require("cors");
require("express-async-errors");

const workshopRoutes = require("./routes/workshopRoutes");

const app = express();
app.use(cors());
app.use(express.json());

// Health
app.get("/api/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Routes
app.use("/api/workshops", workshopRoutes);

// Error handling
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, message: "خطأ في السيرفر" });
});

module.exports = app;