// src/controllers/workshopController.js
const Joi = require("joi");
const mongoose = require("mongoose");
const Workshop = require("../models/Workshop");
const { success, error } = require("../utils/response");
const { generateReport } = require("../services/reportService");
const {
  generateWeeklyStructured,
  generateMonthlyStructured,
  generateYearlyStructured,
} = require("../services/structuredReportService");

// إنشاء ورشة
exports.createWorkshop = async (req, res) => {
  const schema = Joi.object({ name: Joi.string().trim().min(2).max(100).required() });
  const { error: vErr, value } = schema.validate(req.body);
  if (vErr) return error(res, vErr.details[0].message, 400);
  const exists = await Workshop.findOne({ name: value.name });
  if (exists) return error(res, "الورشة موجودة بالفعل", 400);
  const workshop = await Workshop.create({ name: value.name });
  return success(res, workshop, "تم إنشاء الورشة");
};

// عرض كل الورش
exports.getWorkshops = async (req, res) => {
  const { q } = req.query;
  const filter = q ? { name: { $regex: q, $options: "i" } } : {};
  const workshops = await Workshop.find(filter).sort({ name: 1 });
  return success(res, workshops, "قائمة الورش");
};

// جلب ورشة
exports.getWorkshopById = async (req, res) => {
  const { workshopId } = req.params;
  if (!mongoose.isValidObjectId(workshopId)) return error(res, "معرّف غير صالح", 400);
  const workshop = await Workshop.findById(workshopId);
  if (!workshop) return error(res, "الورشة غير موجودة", 404);
  return success(res, workshop, "تفاصيل الورشة");
};

// تحديث اسم ورشة
exports.updateWorkshop = async (req, res) => {
  const { workshopId } = req.params;
  const schema = Joi.object({ name: Joi.string().trim().min(2).max(100).required() });
  const { error: vErr, value } = schema.validate(req.body);
  if (vErr) return error(res, vErr.details[0].message, 400);
  const updated = await Workshop.findByIdAndUpdate(
    workshopId,
    { $set: { name: value.name } },
    { new: true, runValidators: true }
  );
  if (!updated) return error(res, "الورشة غير موجودة", 404);
  return success(res, updated, "تم تحديث الورشة");
};

// إضافة طلبية (مع دعم مبلغ مدفوع ابتدائي)
exports.addOrder = async (req, res) => {
  const { workshopId } = req.params;
  const schema = Joi.object({
    orderName: Joi.string().trim().max(120).optional(),
    itemsCount: Joi.number().integer().min(1).default(1),
    totalPrice: Joi.number().min(0).required(),
    amountPaid: Joi.number().min(0).optional(),
    isPaid: Joi.boolean().optional(), // لأجل التوافق: إذا true ولم تُرسل amountPaid سنسدد كامل المبلغ
    createdAt: Joi.date().optional(),
    notes: Joi.string().allow("", null).max(500).optional(),
  });
  const { error: vErr, value } = schema.validate(req.body);
  if (vErr) return error(res, vErr.details[0].message, 400);

  const workshop = await Workshop.findById(workshopId);
  if (!workshop) return error(res, "الورشة غير موجودة", 404);

  let amountPaid = value.amountPaid ?? 0;
  if (value.isPaid === true && value.amountPaid == null) {
    amountPaid = value.totalPrice;
  }
  if (amountPaid > value.totalPrice) amountPaid = value.totalPrice;

  const payload = {
    orderName: value.orderName || "طلبية",
    itemsCount: value.itemsCount,
    totalPrice: value.totalPrice,
    amountPaid,
    createdAt: value.createdAt || new Date(),
    notes: value.notes || undefined,
    payments: amountPaid > 0 ? [{ amount: amountPaid, at: new Date(), note: "دفعة ابتدائية" }] : [],
  };

  workshop.orders.push(payload);
  await workshop.save();

  const newOrder = workshop.orders[workshop.orders.length - 1];
  return success(res, { workshop, order: newOrder }, "تمت إضافة الطلبية");
};

// تعديل طلبية (يمكن تعديل totalPrice/amountPaid)
exports.updateOrder = async (req, res) => {
  const { workshopId, orderId } = req.params;
  const schema = Joi.object({
    orderName: Joi.string().trim().max(120).optional(),
    itemsCount: Joi.number().integer().min(1).optional(),
    totalPrice: Joi.number().min(0).optional(),
    amountPaid: Joi.number().min(0).optional(),
    createdAt: Joi.date().optional(),
    notes: Joi.string().allow("", null).max(500).optional(),
    // isPaid متروك للتوافق، لا يُخزَّن مباشرة
    isPaid: Joi.boolean().optional(),
  });
  const { error: vErr, value } = schema.validate(req.body);
  if (vErr) return error(res, vErr.details[0].message, 400);

  const workshop = await Workshop.findById(workshopId);
  if (!workshop) return error(res, "الورشة غير موجودة", 404);
  const order = workshop.orders.id(orderId);
  if (!order) return error(res, "الطلبية غير موجودة", 404);

  // نطبّق التغييرات
  if (value.orderName != null) order.orderName = value.orderName;
  if (value.itemsCount != null) order.itemsCount = value.itemsCount;
  if (value.createdAt != null) order.createdAt = value.createdAt;
  if (value.notes != null) order.notes = value.notes;
  if (value.totalPrice != null) order.totalPrice = value.totalPrice;

  // إذا أرسل amountPaid نحدّثه (مع ضبط عدم تجاوزه totalPrice)
  if (value.amountPaid != null) {
    order.amountPaid = Math.max(0, Math.min(value.amountPaid, order.totalPrice));
  } else if (value.isPaid === true) {
    // توافق: إذا isPaid=true ولم يرسل amountPaid
    order.amountPaid = order.totalPrice;
  }

  await workshop.save();
  return success(res, order, "تم تعديل الطلبية");
};

// حذف طلبية
exports.deleteOrder = async (req, res) => {
  const { workshopId, orderId } = req.params;
  const workshop = await Workshop.findById(workshopId);
  if (!workshop) return error(res, "الورشة غير موجودة", 404);
  const order = workshop.orders.id(orderId);
  if (!order) return error(res, "الطلبية غير موجودة", 404);
  order.deleteOne();
  await workshop.save();
  return success(res, { orderId }, "تم حذف الطلبية");
};

// إضافة دفعة جزئية للطلبية
// body: { amount: Number (>0), at?: Date, note?: String }
exports.addPayment = async (req, res) => {
  const { workshopId, orderId } = req.params;
  const schema = Joi.object({
    amount: Joi.number().greater(0).required(),
    at: Joi.date().optional(),
    note: Joi.string().allow("", null).max(200).optional(),
  });
  const { error: vErr, value } = schema.validate(req.body);
  if (vErr) return error(res, vErr.details[0].message, 400);

  const workshop = await Workshop.findById(workshopId);
  if (!workshop) return error(res, "الورشة غير موجودة", 404);
  const order = workshop.orders.id(orderId);
  if (!order) return error(res, "الطلبية غير موجودة", 404);

  const remaining = Math.max(0, order.totalPrice - order.amountPaid);
  if (remaining <= 0) return error(res, "لا يوجد دين متبقٍ على هذه الطلبية", 400);

  const used = Math.min(remaining, value.amount);
  order.amountPaid += used;
  order.payments.push({ amount: used, at: value.at || new Date(), note: value.note || "دفعة" });

  await workshop.save();
  return success(res, order, `تم تسجيل دفعة بقيمة ${used}`);
};

// تسديد كامل المتبقي (توافق مع المسار القديم)
exports.payOrder = async (req, res) => {
  const { workshopId, orderId } = req.params;
  const workshop = await Workshop.findById(workshopId);
  if (!workshop) return error(res, "الورشة غير موجودة", 404);
  const order = workshop.orders.id(orderId);
  if (!order) return error(res, "الطلبية غير موجودة", 404);

  const remaining = Math.max(0, order.totalPrice - order.amountPaid);
  if (remaining <= 0) return success(res, order, "الطلبية مدفوعة بالكامل بالفعل");

  order.amountPaid += remaining;
  order.payments.push({ amount: remaining, at: new Date(), note: "تسديد كامل" });

  await workshop.save();
  return success(res, order, "تم تسديد الطلبية بالكامل");
};

// قائمة الطلبيات لورشة (مع paid=true/false بناءً على الدين)
exports.listOrdersForWorkshop = async (req, res) => {
  const { workshopId } = req.params;
  const { paid, from, to } = req.query;

  const workshop = await Workshop.findById(workshopId).lean();
  if (!workshop) return error(res, "الورشة غير موجودة", 404);

  let orders = workshop.orders || [];

  if (from) {
    const fromDate = new Date(from);
    orders = orders.filter((o) => new Date(o.createdAt) >= fromDate);
  }
  if (to) {
    const toDate = new Date(to);
    orders = orders.filter((o) => new Date(o.createdAt) <= toDate);
  }

  if (paid === "true" || paid === "false") {
    const wantPaid = paid === "true";
    orders = orders.filter((o) => {
      const debt = Math.max(0, (o.totalPrice || 0) - (o.amountPaid || 0));
      return wantPaid ? debt === 0 : debt > 0;
    });
  }

  return success(res, { workshopId, workshopName: workshop.name, orders }, "قائمة الطلبيات");
};

// الديون (طلبات دين فقط عبر كل الورش)
exports.getDebts = async (req, res) => {
  const { workshopId, workshopName, from, to } = req.query;
  const matchWorkshops = {};
  if (workshopId) matchWorkshops._id = new mongoose.Types.ObjectId(workshopId);
  if (workshopName) matchWorkshops.name = workshopName;

  const timeMatch = {};
  if (from) timeMatch.$gte = new Date(from);
  if (to) timeMatch.$lte = new Date(to);

  const pipeline = [
    { $match: matchWorkshops },
    { $unwind: "$orders" },
    ...(from || to ? [{ $match: { "orders.createdAt": timeMatch } }] : []),
    {
      $addFields: {
        orderDebt: {
          $max: [{ $subtract: ["$orders.totalPrice", "$orders.amountPaid"] }, 0],
        },
      },
    },
    { $match: { orderDebt: { $gt: 0 } } },
    {
      $project: {
        _id: 0,
        workshopId: "$_id",
        workshopName: "$name",
        orderId: "$orders._id",
        orderName: "$orders.orderName",
        itemsCount: "$orders.itemsCount",
        totalPrice: "$orders.totalPrice",
        amountPaid: "$orders.amountPaid",
        debt: "$orderDebt",
        createdAt: "$orders.createdAt",
        notes: "$orders.notes",
      },
    },
    { $sort: { createdAt: -1 } },
  ];

  const debts = await Workshop.aggregate(pipeline);
  const totals = debts.reduce(
    (acc, d) => {
      acc.ordersCount += 1;
      acc.itemsCount += d.itemsCount || 0;
      acc.totalAmount += d.totalPrice || 0;
      acc.paidAmount += d.amountPaid || 0;
      acc.debtAmount += d.debt || 0;
      return acc;
    },
    { ordersCount: 0, itemsCount: 0, totalAmount: 0, paidAmount: 0, debtAmount: 0 }
  );

  return success(res, { debts, totals }, "الديون غير المسددة");
};

// التقارير القديمة (ملخص) — محدثة لتستخدم amountPaid
exports.getReports = async (req, res) => {
  const { period = "weekly", includeOrders, workshopId, workshopName, from, to } = req.query;
  const include = includeOrders === "true";
  const report = await generateReport({
    period,
    includeOrders: include,
    workshopId,
    workshopName,
    from,
    to,
  });
  return success(res, report, "تقرير الملخص");
};

// التقارير الجديدة: structured
exports.getWeeklyStructured = async (req, res) => {
  const { date } = req.query;
  const data = await generateWeeklyStructured({ date });
  return success(res, data, "تقرير أسبوعي مفصل (سبت-جمعة)");
};

exports.getMonthlyStructured = async (req, res) => {
  const { year, month } = req.query;
  const data = await generateMonthlyStructured({ year: Number(year), month: Number(month) });
  return success(res, data, "تقرير شهري مقسّم إلى أسابيع");
};

exports.getYearlyStructured = async (req, res) => {
  const { year } = req.query;
  const data = await generateYearlyStructured({ year: Number(year) });
  return success(res, data, "تقرير سنوي مقسّم إلى أشهر");
};

// إدخال من البوت عبر اسم الورشة
exports.botCreateOrderByWorkshopName = async (req, res) => {
  const schema = Joi.object({
    workshopName: Joi.string().trim().min(2).max(100).required(),
    orderName: Joi.string().trim().max(120).optional(),
    itemsCount: Joi.number().integer().min(1).default(1),
    totalPrice: Joi.number().min(0).required(),
    amountPaid: Joi.number().min(0).optional(),
    isPaid: Joi.boolean().optional(),
    createdAt: Joi.date().optional(),
    notes: Joi.string().allow("", null).max(500).optional(),
    allowAutoCreateWorkshop: Joi.boolean().default(false),
  });
  const { error: vErr, value } = schema.validate(req.body);
  if (vErr) return error(res, vErr.details[0].message, 400);

  let workshop = await Workshop.findOne({ name: value.workshopName });
  const allowAutoCreate =
    value.allowAutoCreateWorkshop ||
    process.env.ALLOW_AUTO_CREATE_WORKSHOPS === "true";

  if (!workshop && allowAutoCreate) {
    workshop = await Workshop.create({ name: value.workshopName });
  }
  if (!workshop) return error(res, "الورشة غير موجودة", 404);

  let amountPaid = value.amountPaid ?? 0;
  if (value.isPaid === true && value.amountPaid == null) amountPaid = value.totalPrice;
  if (amountPaid > value.totalPrice) amountPaid = value.totalPrice;

  const payload = {
    orderName: value.orderName || "طلبية",
    itemsCount: value.itemsCount,
    totalPrice: value.totalPrice,
    amountPaid,
    createdAt: value.createdAt || new Date(),
    notes: value.notes || undefined,
    payments: amountPaid > 0 ? [{ amount: amountPaid, at: new Date(), note: "دفعة ابتدائية" }] : [],
  };

  workshop.orders.push(payload);
  await workshop.save();

  const newOrder = workshop.orders[workshop.orders.length - 1];
  return success(res, { workshopId: workshop.id, order: newOrder }, "تمت إضافة الطلبية (بوت)");
};




// // src/controllers/workshopController.js
// const Joi = require("joi");
// const mongoose = require("mongoose");
// const Workshop = require("../models/Workshop");
// const { success, error } = require("../utils/response");
// const { generateReport } = require("../services/reportService");

// // إنشاء ورشة
// exports.createWorkshop = async (req, res) => {
//   const schema = Joi.object({
//     name: Joi.string().trim().min(2).max(100).required(),
//   });
//   const { error: vErr, value } = schema.validate(req.body);
//   if (vErr) return error(res, vErr.details[0].message, 400);

//   const exists = await Workshop.findOne({ name: value.name });
//   if (exists) return error(res, "الورشة موجودة بالفعل", 400);

//   const workshop = await Workshop.create({ name: value.name });
//   return success(res, workshop, "تم إنشاء الورشة");
// };

// // عرض جميع الورش مع إمكانية البحث بالاسم
// exports.getWorkshops = async (req, res) => {
//   const { q } = req.query; // اسم جزئي اختياري
//   const filter = q ? { name: { $regex: q, $options: "i" } } : {};
//   const workshops = await Workshop.find(filter).sort({ name: 1 });
//   return success(res, workshops, "قائمة الورش");
// };

// // جلب ورشة واحدة
// exports.getWorkshopById = async (req, res) => {
//   const { workshopId } = req.params;
//   if (!mongoose.isValidObjectId(workshopId)) return error(res, "معرّف غير صالح", 400);
//   const workshop = await Workshop.findById(workshopId);
//   if (!workshop) return error(res, "الورشة غير موجودة", 404);
//   return success(res, workshop, "تفاصيل الورشة");
// };

// // تحديث اسم الورشة
// exports.updateWorkshop = async (req, res) => {
//   const { workshopId } = req.params;
//   const schema = Joi.object({
//     name: Joi.string().trim().min(2).max(100).required(),
//   });
//   const { error: vErr, value } = schema.validate(req.body);
//   if (vErr) return error(res, vErr.details[0].message, 400);

//   const updated = await Workshop.findByIdAndUpdate(
//     workshopId,
//     { $set: { name: value.name } },
//     { new: true, runValidators: true }
//   );
//   if (!updated) return error(res, "الورشة غير موجودة", 404);
//   return success(res, updated, "تم تحديث الورشة");
// };

// // حذف طلبية
// exports.deleteOrder = async (req, res) => {
//   const { workshopId, orderId } = req.params;
//   const workshop = await Workshop.findById(workshopId);
//   if (!workshop) return error(res, "الورشة غير موجودة", 404);
//   const order = workshop.orders.id(orderId);
//   if (!order) return error(res, "الطلبية غير موجودة", 404);

//   order.deleteOne();
//   await workshop.save();
//   return success(res, { orderId }, "تم حذف الطلبية");
// };

// // إضافة طلبية لورشة (باستخدام workshopId)
// exports.addOrder = async (req, res) => {
//   const { workshopId } = req.params;

//   const schema = Joi.object({
//     orderName: Joi.string().trim().max(120).optional(),
//     itemsCount: Joi.number().integer().min(1).default(1),
//     totalPrice: Joi.number().min(0).required(),
//     isPaid: Joi.boolean().default(false),
//     createdAt: Joi.date().optional(),
//     notes: Joi.string().allow("", null).max(500).optional(),
//   });

//   const { error: vErr, value } = schema.validate(req.body);
//   if (vErr) return error(res, vErr.details[0].message, 400);

//   const workshop = await Workshop.findById(workshopId);
//   if (!workshop) return error(res, "الورشة غير موجودة", 404);

//   const payload = {
//     orderName: value.orderName || "طلبية",
//     itemsCount: value.itemsCount,
//     totalPrice: value.totalPrice,
//     isPaid: value.isPaid,
//     createdAt: value.createdAt || new Date(),
//     notes: value.notes || undefined,
//   };

//   if (payload.isPaid) {
//     payload.paidAt = new Date();
//   }

//   workshop.orders.push(payload);
//   await workshop.save();

//   // آخر عنصر هو المُضاف
//   const newOrder = workshop.orders[workshop.orders.length - 1];
//   return success(res, { workshop, order: newOrder }, "تمت إضافة الطلبية");
// };

// // تعديل طلبية
// exports.updateOrder = async (req, res) => {
//   const { workshopId, orderId } = req.params;

//   const schema = Joi.object({
//     orderName: Joi.string().trim().max(120).optional(),
//     itemsCount: Joi.number().integer().min(1).optional(),
//     totalPrice: Joi.number().min(0).optional(),
//     isPaid: Joi.boolean().optional(),
//     createdAt: Joi.date().optional(),
//     notes: Joi.string().allow("", null).max(500).optional(),
//   });

//   const { error: vErr, value } = schema.validate(req.body);
//   if (vErr) return error(res, vErr.details[0].message, 400);

//   const workshop = await Workshop.findById(workshopId);
//   if (!workshop) return error(res, "الورشة غير موجودة", 404);
//   const order = workshop.orders.id(orderId);
//   if (!order) return error(res, "الطلبية غير موجودة", 404);

//   Object.assign(order, value);
//   if (value.isPaid === true && !order.paidAt) order.paidAt = new Date();
//   if (value.isPaid === false) order.paidAt = null;

//   await workshop.save();
//   return success(res, order, "تم تعديل الطلبية");
// };

// // تسديد دين (تحديد isPaid = true)
// exports.payOrder = async (req, res) => {
//   const { workshopId, orderId } = req.params;
//   const workshop = await Workshop.findById(workshopId);
//   if (!workshop) return error(res, "الورشة غير موجودة", 404);

//   const order = workshop.orders.id(orderId);
//   if (!order) return error(res, "الطلبية غير موجودة", 404);

//   order.isPaid = true;
//   order.paidAt = new Date();

//   await workshop.save();
//   return success(res, order, "تم تسديد الطلبية");
// };

// // إدخال من البوت عبر اسم الورشة مباشرة
// // body: { workshopName, itemsCount, totalPrice, isPaid, orderName, notes }
// exports.botCreateOrderByWorkshopName = async (req, res) => {
//   const schema = Joi.object({
//     workshopName: Joi.string().trim().min(2).max(100).required(),
//     orderName: Joi.string().trim().max(120).optional(),
//     itemsCount: Joi.number().integer().min(1).default(1),
//     totalPrice: Joi.number().min(0).required(),
//     isPaid: Joi.boolean().default(false),
//     createdAt: Joi.date().optional(),
//     notes: Joi.string().allow("", null).max(500).optional(),
//     allowAutoCreateWorkshop: Joi.boolean().default(false),
//   });
//   const { error: vErr, value } = schema.validate(req.body);
//   if (vErr) return error(res, vErr.details[0].message, 400);

//   let workshop = await Workshop.findOne({ name: value.workshopName });

//   const allowAutoCreate =
//     value.allowAutoCreateWorkshop ||
//     process.env.ALLOW_AUTO_CREATE_WORKSHOPS === "true";

//   if (!workshop && allowAutoCreate) {
//     workshop = await Workshop.create({ name: value.workshopName });
//   }

//   if (!workshop) return error(res, "الورشة غير موجودة", 404);

//   const payload = {
//     orderName: value.orderName || "طلبية",
//     itemsCount: value.itemsCount,
//     totalPrice: value.totalPrice,
//     isPaid: value.isPaid,
//     createdAt: value.createdAt || new Date(),
//     notes: value.notes || undefined,
//   };
//   if (payload.isPaid) payload.paidAt = new Date();

//   workshop.orders.push(payload);
//   await workshop.save();

//   const newOrder = workshop.orders[workshop.orders.length - 1];
//   return success(res, { workshopId: workshop.id, order: newOrder }, "تمت إضافة الطلبية (بوت)");
// };

// // قائمة الطلبيات لورشة مع فلاتر (مدفوع/غير مدفوع، من/إلى)
// exports.listOrdersForWorkshop = async (req, res) => {
//   const { workshopId } = req.params;
//   const { paid, from, to } = req.query;

//   const workshop = await Workshop.findById(workshopId).lean();
//   if (!workshop) return error(res, "الورشة غير موجودة", 404);

//   let orders = workshop.orders || [];

//   if (paid === "true" || paid === "false") {
//     const isPaid = paid === "true";
//     orders = orders.filter((o) => o.isPaid === isPaid);
//   }
//   if (from) {
//     const fromDate = new Date(from);
//     orders = orders.filter((o) => new Date(o.createdAt) >= fromDate);
//   }
//   if (to) {
//     const toDate = new Date(to);
//     orders = orders.filter((o) => new Date(o.createdAt) <= toDate);
//   }

//   return success(res, { workshopId, workshopName: workshop.name, orders }, "قائمة الطلبيات");
// };

// // الديون غير المسددة عبر كل الورش (مع فلاتر اختيارية)
// exports.getDebts = async (req, res) => {
//   const { workshopId, workshopName, from, to } = req.query;
//   const matchWorkshops = {};
//   if (workshopId) matchWorkshops._id = new mongoose.Types.ObjectId(workshopId);
//   if (workshopName) matchWorkshops.name = workshopName;

//   const matchOrders = { "orders.isPaid": false };
//   if (from) matchOrders["orders.createdAt"] = { ...(matchOrders["orders.createdAt"] || {}), $gte: new Date(from) };
//   if (to) matchOrders["orders.createdAt"] = { ...(matchOrders["orders.createdAt"] || {}), $lte: new Date(to) };

//   const pipeline = [
//     { $match: matchWorkshops },
//     { $unwind: "$orders" },
//     { $match: matchOrders },
//     {
//       $project: {
//         _id: 0,
//         workshopId: "$_id",
//         workshopName: "$name",
//         orderId: "$orders._id",
//         orderName: "$orders.orderName",
//         itemsCount: "$orders.itemsCount",
//         totalPrice: "$orders.totalPrice",
//         isPaid: "$orders.isPaid",
//         createdAt: "$orders.createdAt",
//         notes: "$orders.notes",
//       },
//     },
//     { $sort: { createdAt: -1 } },
//   ];

//   const debts = await Workshop.aggregate(pipeline);
//   const totals = debts.reduce(
//     (acc, d) => {
//       acc.ordersCount += 1;
//       acc.itemsCount += d.itemsCount || 0;
//       acc.totalAmount += d.totalPrice || 0;
//       return acc;
//     },
//     { ordersCount: 0, itemsCount: 0, totalAmount: 0 }
//   );

//   return success(res, { debts, totals }, "الديون غير المسددة");
// };

// // تقارير ملخصة أسبوعية/شهرية/سنوية أو فترة مخصصة
// exports.getReports = async (req, res) => {
//   const { period = "weekly", includeOrders, workshopId, workshopName, from, to } = req.query;
//   const include = includeOrders === "true";
//   const report = await generateReport({
//     period,
//     includeOrders: include,
//     workshopId,
//     workshopName,
//     from,
//     to,
//   });
//   return success(res, report, "تقرير الملخص");
// };