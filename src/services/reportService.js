// src/services/reportService.js
const moment = require("moment-timezone");
const mongoose = require("mongoose");
const Workshop = require("../models/Workshop");

const TZ = process.env.TIMEZONE || "Africa/Algiers";

// احسب بداية الأسبوع (السبت) ونهاية الأسبوع (الجمعة)
function getWeeklyRange(now = moment.tz(TZ)) {
  const day = now.day(); // 0 الأحد ... 6 السبت
  const diffFromSaturday = (day + 1) % 7; // السبت = 0
  const start = now.clone().startOf("day").subtract(diffFromSaturday, "days");
  const end = start.clone().add(6, "days").endOf("day");
  const activeEnd = moment.min(now.clone().endOf("day"), end); // حتى الآن داخل الأسبوع
  return { start, end, activeEnd };
}

function getMonthlyRange(now = moment.tz(TZ)) {
  const start = now.clone().startOf("month").startOf("day");
  const end = now.clone().endOf("month").endOf("day");
  const activeEnd = moment.min(now.clone().endOf("day"), end);
  return { start, end, activeEnd };
}

function getYearlyRange(now = moment.tz(TZ)) {
  const start = now.clone().startOf("year").startOf("day");
  const end = now.clone().endOf("year").endOf("day");
  const activeEnd = moment.min(now.clone().endOf("day"), end);
  return { start, end, activeEnd };
}

function resolveRange({ period = "weekly", now, from, to } = {}) {
  const current = now ? moment.tz(now, TZ) : moment.tz(TZ);
  if (from && to) {
    const start = moment.tz(from, TZ).startOf("day");
    const end = moment.tz(to, TZ).endOf("day");
    return { start, end, activeEnd: end, period: "custom" };
  }
  if (period === "weekly") return { ...getWeeklyRange(current), period };
  if (period === "monthly") return { ...getMonthlyRange(current), period };
  if (period === "yearly") return { ...getYearlyRange(current), period };
  return { ...getWeeklyRange(current), period: "weekly" };
}

// تجميع ملخصات لكل ورشة + إجمالي عام، مع خيار تضمين تفاصيل الطلبيات
async function aggregateOrders({
  start,
  end,
  includeOrders = false,
  workshopId,
  workshopName,
} = {}) {
  const matchWorkshops = {};
  if (workshopId) matchWorkshops._id = new mongoose.Types.ObjectId(workshopId);
  if (workshopName) matchWorkshops.name = workshopName;

  // نحصل على قائمة الورش المستهدفة لضمان ظهور ورش بدون طلبيات أيضا
  const baseWorkshops = await Workshop.find(matchWorkshops)
    .select("_id name")
    .lean();

  // إن لم توجد ورش مطابقة نرجع ملخصًا فارغًا
  if (baseWorkshops.length === 0) {
    return {
      workshops: [],
      totals: {
        workshopsCount: 0,
        ordersCount: 0,
        itemsCount: 0,
        totalAmount: 0,
        paidAmount: 0,
        unpaidAmount: 0,
        paidOrdersCount: 0,
        unpaidOrdersCount: 0,
      },
    };
  }

  // بناء بايبلاين التجميع
  const pipeline = [
    { $match: matchWorkshops },
    { $unwind: "$orders" },
    {
      $match: {
        "orders.createdAt": { $gte: start.toDate(), $lte: end.toDate() },
      },
    },
    {
      $group: {
        _id: "$_id",
        name: { $first: "$name" },
        ordersCount: { $sum: 1 },
        itemsCount: { $sum: "$orders.itemsCount" },
        totalAmount: { $sum: "$orders.totalPrice" },
        paidAmount: {
          $sum: {
            $cond: [{ $eq: ["$orders.isPaid", true] }, "$orders.totalPrice", 0],
          },
        },
        unpaidAmount: {
          $sum: {
            $cond: [{ $eq: ["$orders.isPaid", false] }, "$orders.totalPrice", 0],
          },
        },
        paidOrdersCount: {
          $sum: { $cond: [{ $eq: ["$orders.isPaid", true] }, 1, 0] },
        },
        unpaidOrdersCount: {
          $sum: { $cond: [{ $eq: ["$orders.isPaid", false] }, 1, 0] },
        },
        ...(includeOrders
          ? {
              orders: {
                $push: {
                  orderId: "$orders._id",
                  orderName: "$orders.orderName",
                  itemsCount: "$orders.itemsCount",
                  totalPrice: "$orders.totalPrice",
                  isPaid: "$orders.isPaid",
                  createdAt: "$orders.createdAt",
                  paidAt: "$orders.paidAt",
                  notes: "$orders.notes",
                },
              },
            }
          : {}),
      },
    },
  ];

  const agg = await Workshop.aggregate(pipeline);

  // دمج نتائج التجميع مع قائمة الورش الأساسية لضمان ظهور ورش بلا طلبيات (قيم صفرية)
  const byId = new Map(agg.map((w) => [String(w._id), w]));
  const workshops = baseWorkshops.map((w) => {
    const found = byId.get(String(w._id));
    return (
      found || {
        _id: w._id,
        name: w.name,
        ordersCount: 0,
        itemsCount: 0,
        totalAmount: 0,
        paidAmount: 0,
        unpaidAmount: 0,
        paidOrdersCount: 0,
        unpaidOrdersCount: 0,
        ...(includeOrders ? { orders: [] } : {}),
      }
    );
  });

  // إجماليات عامة
  const totals = workshops.reduce(
    (acc, w) => {
      acc.ordersCount += w.ordersCount;
      acc.itemsCount += w.itemsCount;
      acc.totalAmount += w.totalAmount;
      acc.paidAmount += w.paidAmount;
      acc.unpaidAmount += w.unpaidAmount;
      acc.paidOrdersCount += w.paidOrdersCount;
      acc.unpaidOrdersCount += w.unpaidOrdersCount;
      return acc;
    },
    {
      workshopsCount: workshops.length,
      ordersCount: 0,
      itemsCount: 0,
      totalAmount: 0,
      paidAmount: 0,
      unpaidAmount: 0,
      paidOrdersCount: 0,
      unpaidOrdersCount: 0,
    }
  );

  // إعادة تسمية الحقول قبل الإرجاع
  return {
    workshops: workshops.map((w) => ({
      workshopId: w._id,
      workshopName: w.name,
      ordersCount: w.ordersCount,
      itemsCount: w.itemsCount,
      totalAmount: w.totalAmount,
      paidAmount: w.paidAmount,
      unpaidAmount: w.unpaidAmount,
      paidOrdersCount: w.paidOrdersCount,
      unpaidOrdersCount: w.unpaidOrdersCount,
      ...(includeOrders ? { orders: w.orders } : {}),
    })),
  totals,
  };
}

exports.generateReport = async ({
  period = "weekly",
  includeOrders = false,
  workshopId,
  workshopName,
  now,
  from,
  to,
} = {}) => {
  const { start, activeEnd, end, period: usedPeriod } = resolveRange({
    period,
    now,
    from,
    to,
  });

  const data = await aggregateOrders({
    start,
    end: activeEnd,
    includeOrders,
    workshopId,
    workshopName,
  });

  return {
    meta: {
      period: usedPeriod,
      timezone: TZ,
      range: {
        start: start.toISOString(),
        end: end.toISOString(),
        activeEnd: activeEnd.toISOString(),
      },
      generatedAt: moment.tz(TZ).toISOString(),
    },
    ...data,
  };
};