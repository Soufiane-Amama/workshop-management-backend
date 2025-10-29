// src/services/structuredReportService.js
const moment = require("moment-timezone");
const mongoose = require("mongoose");
const Workshop = require("../models/Workshop");
const WorkshopDaily = require("../models/WorkshopDaily");

const TZ = process.env.TIMEZONE || "Africa/Algiers";
const dayNames = ["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];

async function getBaseWorkshops(filter = {}) {
  const list = await Workshop.find(filter).select("_id name").lean();
  return list.map((w) => ({ id: String(w._id), name: w.name }));
}

function getWeekRange(targetDate) {
  const now = targetDate ? moment.tz(targetDate, TZ) : moment.tz(TZ);
  const day = now.day(); // 0=الأحد ... 6=السبت
  const diffFromSaturday = (day + 1) % 7; // السبت=0
  const start = now.clone().startOf("day").subtract(diffFromSaturday, "days");
  const end = start.clone().add(6, "days").endOf("day");
  return { start, end };
}

function daysOfWeek(start) {
  return Array.from({ length: 7 }).map((_, i) => {
    const d = start.clone().add(i, "days");
    return {
      key: d.format("YYYY-MM-DD"),
      dateISO: d.toISOString(),
      weekdayIndex: d.day(),
      weekdayName: dayNames[d.day()],
      label: `${dayNames[d.day()]} (${d.format("YYYY-MM-DD")})`,
    };
  });
}

exports.generateWeeklyStructured = async ({ date } = {}) => {
  const { start, end } = getWeekRange(date);
  const days = daysOfWeek(start);
  const baseWorkshops = await getBaseWorkshops();

  const pipeline = [
    { $match: { day: { $gte: start.toDate(), $lte: end.toDate() } } },
    {
      $group: {
        _id: { wid: "$workshop", dayKey: "$dayKey" },
        ordersCount: { $sum: "$ordersCount" },
        totalDebt: { $sum: "$dayDebt" },
        paidAmount: { $sum: "$dayPaid" },
        note: { $first: "$note" }, 
      },
    },
    {
      $lookup: { from: "workshops", localField: "_id.wid", foreignField: "_id", as: "w" },
    },
    { $unwind: "$w" },
    {
      $project: {
        wid: "$w._id",
        workshopName: "$w.name",
        dayKey: "$_id.dayKey",
        ordersCount: 1,
        totalDebt: 1,
        paidAmount: 1,
        note: 1, 
      },
    },
  ];

  const agg = await WorkshopDaily.aggregate(pipeline);

  const byWorkshop = new Map();
  for (const w of baseWorkshops) {
    byWorkshop.set(w.id, {
      workshopId: w.id,
      workshopName: w.name,
      days: days.map((d) => ({
        date: d.key,
        label: d.label,
        ordersCount: 0,
        totalAmount: 0,
        note: "", // ✅ إضافة note
      })),
      weeklyTotals: { ordersCount: 0, totalAmount: 0, paidAmount: 0, debtAmount: 0 },
    });
  }

  for (const row of agg) {
    const wid = String(row.wid);
    const wk = byWorkshop.get(wid);
    if (!wk) continue;
    const idx = wk.days.findIndex((d) => d.date === row.dayKey);
    if (idx >= 0) {
      wk.days[idx].ordersCount += row.ordersCount;
      wk.days[idx].totalAmount += row.totalDebt;
      wk.days[idx].note = row.note || "";
    }
    wk.weeklyTotals.ordersCount += row.ordersCount;
    wk.weeklyTotals.totalAmount += row.totalDebt;
    wk.weeklyTotals.paidAmount += row.paidAmount;
  }

  let totals = { ordersCount: 0, totalAmount: 0, paidAmount: 0, debtAmount: 0 };
  for (const wk of byWorkshop.values()) {
    wk.weeklyTotals.debtAmount = Math.max(0, wk.weeklyTotals.totalAmount - wk.weeklyTotals.paidAmount);
    totals.ordersCount += wk.weeklyTotals.ordersCount;
    totals.totalAmount += wk.weeklyTotals.totalAmount;
    totals.paidAmount += wk.weeklyTotals.paidAmount;
    totals.debtAmount += wk.weeklyTotals.debtAmount;
  }

  return {
    meta: {
      type: "weekly-structured",
      timezone: TZ,
      range: { start: start.toISOString(), end: end.toISOString() },
      days: days.map((d) => ({ date: d.key, label: d.label })),
    },
    workshops: Array.from(byWorkshop.values()),
    totals,
  };
};

exports.generateMonthlyStructured = async ({ year, month } = {}) => {
  const ref = moment.tz(
    `${year || moment.tz(TZ).year()}-${month || moment.tz(TZ).month() + 1}-01`,
    "YYYY-M-D",
    TZ
  );
  const start = ref.clone().startOf("month").startOf("day");
  const end = ref.clone().endOf("month").endOf("day");

  const baseWorkshops = await getBaseWorkshops();

  const pipeline = [
    { $match: { day: { $gte: start.toDate(), $lte: end.toDate() } } },
    {
      $project: {
        workshop: 1,
        ordersCount: 1,
        dayDebt: 1,
        dayPaid: 1,
        weekStart: {
          $dateTrunc: {
            date: "$day",
            unit: "week",
            timezone: TZ,
            startOfWeek: "saturday",
          },
        },
      },
    },
    {
      $group: {
        _id: { wid: "$workshop", weekStart: "$weekStart" },
        ordersCount: { $sum: "$ordersCount" },
        totalDebt: { $sum: "$dayDebt" },
        paidAmount: { $sum: "$dayPaid" },
      },
    },
    { $sort: { "_id.weekStart": 1 } },
    {
      $lookup: { from: "workshops", localField: "_id.wid", foreignField: "_id", as: "w" },
    },
    { $unwind: "$w" },
  ];

  const agg = await WorkshopDaily.aggregate(pipeline);

  const weekStarts = Array.from(
    new Set(agg.map((r) => r._id.weekStart.toISOString()))
  ).sort();

  const arabicWeekNames = ["الأسبوع الأول", "الأسبوع الثاني", "الأسبوع الثالث", "الأسبوع الرابع", "الأسبوع الخامس"];

  const weekIndexByStart = new Map();
  weekStarts.forEach((iso, idx) => weekIndexByStart.set(iso, idx));

  const byWorkshop = new Map();
  for (const w of baseWorkshops) {
    byWorkshop.set(w.id, {
      workshopId: w.id,
      workshopName: w.name,
      weeks: weekStarts.map((iso, idx) => ({
        label: arabicWeekNames[idx] || `الأسبوع ${idx + 1}`,
        weekStart: iso,
        ordersCount: 0,
        totalAmount: 0,
        paidAmount: 0,
        debtAmount: 0,
      })),
      monthlyTotals: { ordersCount: 0, totalAmount: 0, paidAmount: 0, debtAmount: 0 },
    });
  }

  for (const row of agg) {
    const wid = String(row._id.wid);
    const wk = byWorkshop.get(wid);
    if (!wk) continue;
    const iso = row._id.weekStart.toISOString();
    const idx = weekIndexByStart.get(iso);
    if (idx != null) {
      const bucket = wk.weeks[idx];
      bucket.ordersCount += row.ordersCount;
      bucket.totalAmount += row.totalDebt;
      bucket.paidAmount += row.paidAmount;
    }
  }

  let totals = { ordersCount: 0, totalAmount: 0, paidAmount: 0, debtAmount: 0 };
  for (const wk of byWorkshop.values()) {
    wk.monthlyTotals.ordersCount = wk.weeks.reduce((s, b) => s + b.ordersCount, 0);
    wk.monthlyTotals.totalAmount = wk.weeks.reduce((s, b) => s + b.totalAmount, 0);
    wk.monthlyTotals.paidAmount = wk.weeks.reduce((s, b) => s + b.paidAmount, 0);
    wk.monthlyTotals.debtAmount = Math.max(0, wk.monthlyTotals.totalAmount - wk.monthlyTotals.paidAmount);

    totals.ordersCount += wk.monthlyTotals.ordersCount;
    totals.totalAmount += wk.monthlyTotals.totalAmount;
    totals.paidAmount += wk.monthlyTotals.paidAmount;
    totals.debtAmount += wk.monthlyTotals.debtAmount;
  }

  return {
    meta: {
      type: "monthly-structured",
      timezone: TZ,
      month: start.format("YYYY-MM"),
      range: { start: start.toISOString(), end: end.toISOString() },
      weeks: weekStarts.map((iso, idx) => ({
        label: arabicWeekNames[idx] || `الأسبوع ${idx + 1}`,
        weekStart: iso,
      })),
    },
    workshops: Array.from(byWorkshop.values()),
    totals,
  };
};

exports.generateYearlyStructured = async ({ year } = {}) => {
  const y = year || moment.tz(TZ).year();
  const start = moment.tz(`${y}-01-01`, "YYYY-MM-DD", TZ).startOf("day");
  const end = start.clone().endOf("year").endOf("day");

  const baseWorkshops = await getBaseWorkshops();

  const pipeline = [
    { $match: { day: { $gte: start.toDate(), $lte: end.toDate() } } },
    {
      $project: {
        workshop: 1,
        ordersCount: 1,
        dayDebt: 1,
        dayPaid: 1,
        ym: {
          $dateToString: { date: "$day", timezone: TZ, format: "%Y-%m" },
        },
      },
    },
    {
      $group: {
        _id: { wid: "$workshop", ym: "$ym" },
        ordersCount: { $sum: "$ordersCount" },
        totalDebt: { $sum: "$dayDebt" },
        paidAmount: { $sum: "$dayPaid" },
      },
    },
    { $sort: { "_id.ym": 1 } },
    {
      $lookup: { from: "workshops", localField: "_id.wid", foreignField: "_id", as: "w" },
    },
    { $unwind: "$w" },
  ];

  const agg = await WorkshopDaily.aggregate(pipeline);

  const months = Array.from({ length: 12 }, (_, i) =>
    moment.tz(`${y}-${String(i + 1).padStart(2, "0")}-01`, "YYYY-MM-DD", TZ).format("YYYY-MM")
  );
  const labels = [
    "الشهر 01","الشهر 02","الشهر 03","الشهر 04","الشهر 05","الشهر 06",
    "الشهر 07","الشهر 08","الشهر 09","الشهر 10","الشهر 11","الشهر 12",
  ];
  const monthIndexByKey = new Map(months.map((m, idx) => [m, idx]));

  const byWorkshop = new Map();
  for (const w of await getBaseWorkshops()) {
    byWorkshop.set(w.id, {
      workshopId: w.id,
      workshopName: w.name,
      months: months.map((m, idx) => ({
        label: labels[idx],
        ym: m,
        ordersCount: 0,
        totalAmount: 0,
        paidAmount: 0,
        debtAmount: 0,
      })),
      yearlyTotals: { ordersCount: 0, totalAmount: 0, paidAmount: 0, debtAmount: 0 },
    });
  }

  for (const row of agg) {
    const wid = String(row._id.wid);
    const wk = byWorkshop.get(wid);
    if (!wk) continue;
    const idx = monthIndexByKey.get(row._id.ym);
    if (idx != null) {
      const bucket = wk.months[idx];
      bucket.ordersCount += row.ordersCount;
      bucket.totalAmount += row.totalDebt;
      bucket.paidAmount += row.paidAmount;
    }
  }

  let totals = { ordersCount: 0, totalAmount: 0, paidAmount: 0, debtAmount: 0 };
  for (const wk of byWorkshop.values()) {
    wk.yearlyTotals.ordersCount = wk.months.reduce((s, b) => s + b.ordersCount, 0);
    wk.yearlyTotals.totalAmount = wk.months.reduce((s, b) => s + b.totalAmount, 0);
    wk.yearlyTotals.paidAmount = wk.months.reduce((s, b) => s + b.paidAmount, 0);
    wk.yearlyTotals.debtAmount = Math.max(0, wk.yearlyTotals.totalAmount - wk.yearlyTotals.paidAmount);

    totals.ordersCount += wk.yearlyTotals.ordersCount;
    totals.totalAmount += wk.yearlyTotals.totalAmount;
    totals.paidAmount += wk.yearlyTotals.paidAmount;
    totals.debtAmount += wk.yearlyTotals.debtAmount;
  }

  return {
    meta: {
      type: "yearly-structured",
      timezone: TZ,
      year: y,
      range: { start: start.toISOString(), end: end.toISOString() },
      months,
    },
    workshops: Array.from(byWorkshop.values()),
    totals,
  };
};








// // src/services/structuredReportService.js
// const moment = require("moment-timezone");
// const mongoose = require("mongoose");
// const Workshop = require("../models/Workshop");

// const TZ = process.env.TIMEZONE || "Africa/Algiers";
// const dayNames = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

// async function getBaseWorkshops(filter = {}) {
//   const list = await Workshop.find(filter).select("_id name").lean();
//   return list.map((w) => ({ id: String(w._id), name: w.name }));
// }

// function getWeekRange(targetDate) {
//   const now = targetDate ? moment.tz(targetDate, TZ) : moment.tz(TZ);
//   const day = now.day(); // 0=الأحد ... 6=السبت
//   const diffFromSaturday = (day + 1) % 7; // السبت = 0
//   const start = now.clone().startOf("day").subtract(diffFromSaturday, "days");
//   const end = start.clone().add(6, "days").endOf("day");
//   return { start, end };
// }

// function daysOfWeek(start) {
//   return Array.from({ length: 7 }).map((_, i) => {
//     const d = start.clone().add(i, "days");
//     return {
//       key: d.format("YYYY-MM-DD"),
//       dateISO: d.toISOString(),
//       weekdayIndex: d.day(),
//       weekdayName: dayNames[d.day()],
//       label: `${dayNames[d.day()]} (${d.format("YYYY-MM-DD")})`,
//     };
//   });
// }

// function safePaidExpr() {
//   return { $min: ["$orders.amountPaid", "$orders.totalPrice"] };
// }
// function safeDebtExpr() {
//   return {
//     $max: [{ $subtract: ["$orders.totalPrice", "$orders.amountPaid"] }, 0],
//   };
// }

// // تقرير أسبوعي مفصّل لكل يوم (سبت→جمعة)
// exports.generateWeeklyStructured = async ({ date } = {}) => {
//   const { start, end } = getWeekRange(date);
//   const days = daysOfWeek(start);
//   const baseWorkshops = await getBaseWorkshops();

//   const pipeline = [
//     { $unwind: "$orders" },
//     {
//       $match: {
//         "orders.createdAt": { $gte: start.toDate(), $lte: end.toDate() },
//       },
//     },
//     {
//       $project: {
//         wid: "$_id",
//         name: "$name",
//         dayKey: {
//           $dateToString: { date: "$orders.createdAt", timezone: TZ, format: "%Y-%m-%d" },
//         },
//         price: "$orders.totalPrice",
//         paid: safePaidExpr(),
//         debt: safeDebtExpr(),
//       },
//     },
//     {
//       $group: {
//         _id: { wid: "$wid", name: "$name", dayKey: "$dayKey" },
//         ordersCount: { $sum: 1 },
//         totalAmount: { $sum: "$price" },
//         paidAmount: { $sum: "$paid" },
//         debtAmount: { $sum: "$debt" },
//       },
//     },
//   ];

//   const agg = await Workshop.aggregate(pipeline);
//   const byWorkshop = new Map();

//   // تهيئة بورش وقيم صفرية
//   for (const w of baseWorkshops) {
//     byWorkshop.set(w.id, {
//       workshopId: w.id,
//       workshopName: w.name,
//       days: days.map((d) => ({
//         date: d.key,
//         label: d.label,
//         ordersCount: 0,
//         totalAmount: 0,
//       })),
//       weeklyTotals: { ordersCount: 0, totalAmount: 0, paidAmount: 0, debtAmount: 0 },
//     });
//   }

//   // ملء البيانات اليومية
//   for (const row of agg) {
//     const wid = String(row._id.wid);
//     const w = byWorkshop.get(wid);
//     if (!w) continue;
//     const dayIdx = w.days.findIndex((d) => d.date === row._id.dayKey);
//     if (dayIdx >= 0) {
//       w.days[dayIdx].ordersCount += row.ordersCount;
//       w.days[dayIdx].totalAmount += row.totalAmount;
//     }
//     w.weeklyTotals.ordersCount += row.ordersCount;
//     w.weeklyTotals.totalAmount += row.totalAmount;
//     w.weeklyTotals.paidAmount += row.paidAmount;
//     w.weeklyTotals.debtAmount += row.debtAmount;
//   }

//   // الإجمالي العام
//   const totals = Array.from(byWorkshop.values()).reduce(
//     (acc, w) => {
//       acc.ordersCount += w.weeklyTotals.ordersCount;
//       acc.totalAmount += w.weeklyTotals.totalAmount;
//       acc.paidAmount += w.weeklyTotals.paidAmount;
//       acc.debtAmount += w.weeklyTotals.debtAmount;
//       return acc;
//     },
//     { ordersCount: 0, totalAmount: 0, paidAmount: 0, debtAmount: 0 }
//   );

//   return {
//     meta: {
//       type: "weekly-structured",
//       timezone: TZ,
//       range: { start: start.toISOString(), end: end.toISOString() },
//       days: days.map((d) => ({ date: d.key, label: d.label })),
//     },
//     workshops: Array.from(byWorkshop.values()),
//     totals,
//   };
// };

// // تقرير شهري: أسابيع الشهر (سبت→جمعة) لكل ورشة
// exports.generateMonthlyStructured = async ({ year, month } = {}) => {
//   const ref = moment.tz(
//     `${year || moment.tz(TZ).year()}-${month || moment.tz(TZ).month() + 1}-01`,
//     "YYYY-M-D",
//     TZ
//   );
//   const start = ref.clone().startOf("month").startOf("day");
//   const end = ref.clone().endOf("month").endOf("day");

//   const baseWorkshops = await getBaseWorkshops();

//   // نحسب weekStart بالسبت باستخدام $dateTrunc
//   const pipeline = [
//     { $unwind: "$orders" },
//     {
//       $match: {
//         "orders.createdAt": { $gte: start.toDate(), $lte: end.toDate() },
//       },
//     },
//     {
//       $project: {
//         wid: "$_id",
//         name: "$name",
//         weekStart: {
//           $dateTrunc: {
//             date: "$orders.createdAt",
//             unit: "week",
//             timezone: TZ,
//             startOfWeek: "saturday",
//           },
//         },
//         price: "$orders.totalPrice",
//         paid: safePaidExpr(),
//         debt: safeDebtExpr(),
//       },
//     },
//     {
//       $group: {
//         _id: { wid: "$wid", name: "$name", weekStart: "$weekStart" },
//         ordersCount: { $sum: 1 },
//         totalAmount: { $sum: "$price" },
//         paidAmount: { $sum: "$paid" },
//         debtAmount: { $sum: "$debt" },
//       },
//     },
//     { $sort: { "_id.weekStart": 1 } },
//   ];

//   const agg = await Workshop.aggregate(pipeline);

//   // كل أسابيع الشهر الموجودة في النتائج
//   const weekStarts = Array.from(
//     new Set(agg.map((r) => r._id.weekStart.toISOString()))
//   ).sort();

//   // تحجيم إلى 4 أو 5 أسابيع بحسب الشهر
//   const arabicWeekNames = ["الأسبوع الأول", "الأسبوع الثاني", "الأسبوع الثالث", "الأسبوع الرابع", "الأسبوع الخامس"];

//   const weekIndexByStart = new Map();
//   weekStarts.forEach((iso, idx) => weekIndexByStart.set(iso, idx));

//   const byWorkshop = new Map();
//   for (const w of baseWorkshops) {
//     byWorkshop.set(w.id, {
//       workshopId: w.id,
//       workshopName: w.name,
//       weeks: weekStarts.map((iso, idx) => ({
//         label: arabicWeekNames[idx] || `الأسبوع ${idx + 1}`,
//         weekStart: iso,
//         ordersCount: 0,
//         totalAmount: 0,
//         paidAmount: 0,
//         debtAmount: 0,
//       })),
//       monthlyTotals: { ordersCount: 0, totalAmount: 0, paidAmount: 0, debtAmount: 0 },
//     });
//   }

//   for (const row of agg) {
//     const wid = String(row._id.wid);
//     const w = byWorkshop.get(wid);
//     if (!w) continue;
//     const iso = row._id.weekStart.toISOString();
//     const idx = weekIndexByStart.get(iso);
//     if (idx != null) {
//       const bucket = w.weeks[idx];
//       bucket.ordersCount += row.ordersCount;
//       bucket.totalAmount += row.totalAmount;
//       bucket.paidAmount += row.paidAmount;
//       bucket.debtAmount += row.debtAmount;
//       w.monthlyTotals.ordersCount += row.ordersCount;
//       w.monthlyTotals.totalAmount += row.totalAmount;
//       w.monthlyTotals.paidAmount += row.paidAmount;
//       w.monthlyTotals.debtAmount += row.debtAmount;
//     }
//   }

//   const totals = Array.from(byWorkshop.values()).reduce(
//     (acc, w) => {
//       acc.ordersCount += w.monthlyTotals.ordersCount;
//       acc.totalAmount += w.monthlyTotals.totalAmount;
//       acc.paidAmount += w.monthlyTotals.paidAmount;
//       acc.debtAmount += w.monthlyTotals.debtAmount;
//       return acc;
//     },
//     { ordersCount: 0, totalAmount: 0, paidAmount: 0, debtAmount: 0 }
//   );

//   return {
//     meta: {
//       type: "monthly-structured",
//       timezone: TZ,
//       month: start.format("YYYY-MM"),
//       range: { start: start.toISOString(), end: end.toISOString() },
//       weeks: weekStarts.map((iso, idx) => ({
//         label: arabicWeekNames[idx] || `الأسبوع ${idx + 1}`,
//         weekStart: iso,
//       })),
//     },
//     workshops: Array.from(byWorkshop.values()),
//     totals,
//   };
// };

// // تقرير سنوي: 12 شهرًا لكل ورشة
// exports.generateYearlyStructured = async ({ year } = {}) => {
//   const y = year || moment.tz(TZ).year();
//   const start = moment.tz(`${y}-01-01`, "YYYY-MM-DD", TZ).startOf("day");
//   const end = start.clone().endOf("year").endOf("day");
//   const baseWorkshops = await getBaseWorkshops();

//   const pipeline = [
//     { $unwind: "$orders" },
//     {
//       $match: {
//         "orders.createdAt": { $gte: start.toDate(), $lte: end.toDate() },
//       },
//     },
//     {
//       $project: {
//         wid: "$_id",
//         name: "$name",
//         ym: {
//           $dateToString: { date: "$orders.createdAt", timezone: TZ, format: "%Y-MM" },
//         },
//         price: "$orders.totalPrice",
//         paid: safePaidExpr(),
//         debt: safeDebtExpr(),
//       },
//     },
//     {
//       $group: {
//         _id: { wid: "$wid", name: "$name", ym: "$ym" },
//         ordersCount: { $sum: 1 },
//         totalAmount: { $sum: "$price" },
//         paidAmount: { $sum: "$paid" },
//         debtAmount: { $sum: "$debt" },
//       },
//     },
//     { $sort: { "_id.ym": 1 } },
//   ];

//   const agg = await Workshop.aggregate(pipeline);

//   // الأشهر 01..12
//   const months = Array.from({ length: 12 }, (_, i) =>
//     moment.tz(`${y}-${String(i + 1).padStart(2, "0")}-01`, "YYYY-MM-DD", TZ).format("YYYY-MM")
//   );

//   const arabicMonthOrderNames = [
//     "الشهر 01","الشهر 02","الشهر 03","الشهر 04",
//     "الشهر 05","الشهر 06","الشهر 07","الشهر 08",
//     "الشهر 09","الشهر 10","الشهر 11","الشهر 12",
//   ];

//   const monthIndexByKey = new Map(months.map((m, idx) => [m, idx]));

//   const byWorkshop = new Map();
//   for (const w of baseWorkshops) {
//     byWorkshop.set(w.id, {
//       workshopId: w.id,
//       workshopName: w.name,
//       months: months.map((m, idx) => ({
//         label: arabicMonthOrderNames[idx],
//         ym: m,
//         ordersCount: 0,
//         totalAmount: 0,
//         paidAmount: 0,
//         debtAmount: 0,
//       })),
//       yearlyTotals: { ordersCount: 0, totalAmount: 0, paidAmount: 0, debtAmount: 0 },
//     });
//   }

//   for (const row of agg) {
//     const wid = String(row._id.wid);
//     const w = byWorkshop.get(wid);
//     if (!w) continue;
//     const idx = monthIndexByKey.get(row._id.ym);
//     if (idx != null) {
//       const bucket = w.months[idx];
//       bucket.ordersCount += row.ordersCount;
//       bucket.totalAmount += row.totalAmount;
//       bucket.paidAmount += row.paidAmount;
//       bucket.debtAmount += row.debtAmount;
//       w.yearlyTotals.ordersCount += row.ordersCount;
//       w.yearlyTotals.totalAmount += row.totalAmount;
//       w.yearlyTotals.paidAmount += row.paidAmount;
//       w.yearlyTotals.debtAmount += row.debtAmount;
//     }
//   }

//   const totals = Array.from(byWorkshop.values()).reduce(
//     (acc, w) => {
//       acc.ordersCount += w.yearlyTotals.ordersCount;
//       acc.totalAmount += w.yearlyTotals.totalAmount;
//       acc.paidAmount += w.yearlyTotals.paidAmount;
//       acc.debtAmount += w.yearlyTotals.debtAmount;
//       return acc;
//     },
//     { ordersCount: 0, totalAmount: 0, paidAmount: 0, debtAmount: 0 }
//   );

//   return {
//     meta: {
//       type: "yearly-structured",
//       timezone: TZ,
//       year: y,
//       range: { start: start.toISOString(), end: end.toISOString() },
//       months,
//     },
//     workshops: Array.from(byWorkshop.values()),
//     totals,
//   };
// };