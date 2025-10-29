// src/jobs/reportJob.js
const cron = require("node-cron");
const vars = require("../utils/vars");
const { generateWeeklyStructured, generateMonthlyStructured, generateYearlyStructured } = require("../services/structuredReportService");

const TIMEZONE = process.env.TIMEZONE || "Africa/Algiers";
const CRON = process.env.REPORT_CRON || "0 9 * * *";

cron.schedule(
  CRON,
  async () => {
    try {
      console.log("⏰ Running structured reports job...");
      const week = await generateWeeklyStructured({});
      const month = await generateMonthlyStructured({});
      const year = await generateYearlyStructured({});
      vars.setVar("structured:weekly", week);
      vars.setVar("structured:monthly", month);
      vars.setVar("structured:yearly", year);
      vars.setVar("lastReportRunAt", new Date().toISOString());
      console.log("📊 Structured reports updated in memory.");
    } catch (err) {
      console.error("❌ Report job error:", err.message);
    }
  },
  { timezone: TIMEZONE }
);

module.exports = {};




// // src/jobs/reportJob.js
// const cron = require("node-cron");
// const { generateReport } = require("../services/reportService");
// const vars = require("../utils/vars");

// const TIMEZONE = process.env.TIMEZONE || "Africa/Algiers";
// // 09:00 كل يوم
// const CRON = process.env.REPORT_CRON || "0 9 * * *";

// cron.schedule(
//   CRON,
//   async () => {
//     try {
//       console.log("⏰ Running daily report job...");
//       const periods = ["weekly", "monthly", "yearly"];
//       for (const p of periods) {
//         const report = await generateReport({ period: p, includeOrders: false });
//         vars.setVar(`report:${p}`, report);
//       }
//       vars.setVar("lastReportRunAt", new Date().toISOString());
//       console.log("📊 Reports refreshed and stored in vars.");
//     } catch (err) {
//       console.error("❌ Report job error:", err.message);
//     }
//   },
//   { timezone: TIMEZONE }
// );

// module.exports = {}; // مجرد تفعيل للجدولة عند require