// src/config/seed.js
const Workshop = require("../models/Workshop");

const DEFAULT_WORKSHOPS = [
  "01- ورشة عدنان",
  "02- ورشة بلال",
  "03- ورشة قيس",
  "04- ورشة زكرياء",
  "05- ورشة عمي براهيم",
  "06- ورشة المزابي",
  "07- ورشة الخير",
  "08- ورشة أشرف",
];

async function seedDefaultWorkshops() {
  try {
    const count = await Workshop.countDocuments();
    if (count > 0) {
      console.log("ℹ️ Seed: Workshops already exist, skipping seeding.");
      return;
    }
    await Promise.all(
      DEFAULT_WORKSHOPS.map((name) =>
        Workshop.updateOne({ name }, { $setOnInsert: { name } }, { upsert: true })
      )
    );
    console.log("🌱 Seed: Default workshops inserted.");
  } catch (err) {
    console.error("❌ Seed error:", err.message);
  }
}

module.exports = seedDefaultWorkshops;