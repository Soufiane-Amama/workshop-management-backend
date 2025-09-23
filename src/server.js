// src/server.js
const dotenv = require("dotenv");
dotenv.config();

const connectDB = require("./config/db");
const seedDefaultWorkshops = require("./config/seed");
const app = require("./app");
require("./jobs/reportJob");

const PORT = process.env.PORT || 5000;

async function bootstrap() {
  await connectDB();
  await seedDefaultWorkshops();

  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`⏱️ Timezone: ${process.env.TIMEZONE || "Africa/Algiers"}`);
  });
}

bootstrap().catch((err) => {
  console.error("❌ Fatal:", err);
  process.exit(1);
});