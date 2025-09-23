// src/controllers/workshopController.js
const Joi = require("joi");
const mongoose = require("mongoose");
const Workshop = require("../models/Workshop");
const { success, error } = require("../utils/response");
const { generateReport } = require("../services/reportService");

// إنشاء ورشة
exports.createWorkshop = async (req, res) => {
  const schema = Joi.object({
    name: Joi.string().trim().min(2).max(100).required(),
  });
  const { error: vErr, value } = schema.validate(req.body);
  if (vErr) return error(res, vErr.details[0].message, 400);

  const exists = await Workshop.findOne({ name: value.name });
  if (exists) return error(res, "الورشة موجودة بالفعل", 400);

  const workshop = await Workshop.create({ name: value.name });
  return success(res, workshop, "تم إنشاء الورشة");
};

// عرض جميع الورش مع إمكانية البحث بالاسم
exports.getWorkshops = async (req, res) => {
  const { q } = req.query; // اسم جزئي اختياري
  const filter = q ? { name: { $regex: q, $options: "i" } } : {};
  const workshops = await Workshop.find(filter).sort({ name: 1 });
  return success(res, workshops, "قائمة الورش");
};

// جلب ورشة واحدة
exports.getWorkshopById = async (req, res) => {
  const { workshopId } = req.params;
  if (!mongoose.isValidObjectId(workshopId)) return error(res, "معرّف غير صالح", 400);
  const workshop = await Workshop.findById(workshopId);
  if (!workshop) return error(res, "الورشة غير موجودة", 404);
  return success(res, workshop, "تفاصيل الورشة");
};

// تحديث اسم الورشة
exports.updateWorkshop = async (req, res) => {
  const { workshopId } = req.params;
  const schema = Joi.object({
    name: Joi.string().trim().min(2).max(100).required(),
  });
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

// إضافة طلبية لورشة (باستخدام workshopId)
exports.addOrder = async (req, res) => {
  const { workshopId } = req.params;

  const schema = Joi.object({
    orderName: Joi.string().trim().max(120).optional(),
    itemsCount: Joi.number().integer().min(1).default(1),
    totalPrice: Joi.number().min(0).required(),
    isPaid: Joi.boolean().default(false),
    createdAt: Joi.date().optional(),
    notes: Joi.string().allow("", null).max(500).optional(),
  });

  const { error: vErr, value } = schema.validate(req.body);
  if (vErr) return error(res, vErr.details[0].message, 400);

  const workshop = await Workshop.findById(workshopId);
  if (!workshop) return error(res, "الورشة غير موجودة", 404);

  const payload = {
    orderName: value.orderName || "طلبية",
    itemsCount: value.itemsCount,
    totalPrice: value.totalPrice,
    isPaid: value.isPaid,
    createdAt: value.createdAt || new Date(),
    notes: value.notes || undefined,
  };

  if (payload.isPaid) {
    payload.paidAt = new Date();
  }

  workshop.orders.push(payload);
  await workshop.save();

  // آخر عنصر هو المُضاف
  const newOrder = workshop.orders[workshop.orders.length - 1];
  return success(res, { workshop, order: newOrder }, "تمت إضافة الطلبية");
};

// تعديل طلبية
exports.updateOrder = async (req, res) => {
  const { workshopId, orderId } = req.params;

  const schema = Joi.object({
    orderName: Joi.string().trim().max(120).optional(),
    itemsCount: Joi.number().integer().min(1).optional(),
    totalPrice: Joi.number().min(0).optional(),
    isPaid: Joi.boolean().optional(),
    createdAt: Joi.date().optional(),
    notes: Joi.string().allow("", null).max(500).optional(),
  });

  const { error: vErr, value } = schema.validate(req.body);
  if (vErr) return error(res, vErr.details[0].message, 400);

  const workshop = await Workshop.findById(workshopId);
  if (!workshop) return error(res, "الورشة غير موجودة", 404);
  const order = workshop.orders.id(orderId);
  if (!order) return error(res, "الطلبية غير موجودة", 404);

  Object.assign(order, value);
  if (value.isPaid === true && !order.paidAt) order.paidAt = new Date();
  if (value.isPaid === false) order.paidAt = null;

  await workshop.save();
  return success(res, order, "تم تعديل الطلبية");
};

// تسديد دين (تحديد isPaid = true)
exports.payOrder = async (req, res) => {
  const { workshopId, orderId } = req.params;
  const workshop = await Workshop.findById(workshopId);
  if (!workshop) return error(res, "الورشة غير موجودة", 404);

  const order = workshop.orders.id(orderId);
  if (!order) return error(res, "الطلبية غير موجودة", 404);

  order.isPaid = true;
  order.paidAt = new Date();

  await workshop.save();
  return success(res, order, "تم تسديد الطلبية");
};

// إدخال من البوت عبر اسم الورشة مباشرة
// body: { workshopName, itemsCount, totalPrice, isPaid, orderName, notes }
exports.botCreateOrderByWorkshopName = async (req, res) => {
  const schema = Joi.object({
    workshopName: Joi.string().trim().min(2).max(100).required(),
    orderName: Joi.string().trim().max(120).optional(),
    itemsCount: Joi.number().integer().min(1).default(1),
    totalPrice: Joi.number().min(0).required(),
    isPaid: Joi.boolean().default(false),
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

  const payload = {
    orderName: value.orderName || "طلبية",
    itemsCount: value.itemsCount,
    totalPrice: value.totalPrice,
    isPaid: value.isPaid,
    createdAt: value.createdAt || new Date(),
    notes: value.notes || undefined,
  };
  if (payload.isPaid) payload.paidAt = new Date();

  workshop.orders.push(payload);
  await workshop.save();

  const newOrder = workshop.orders[workshop.orders.length - 1];
  return success(res, { workshopId: workshop.id, order: newOrder }, "تمت إضافة الطلبية (بوت)");
};

// قائمة الطلبيات لورشة مع فلاتر (مدفوع/غير مدفوع، من/إلى)
exports.listOrdersForWorkshop = async (req, res) => {
  const { workshopId } = req.params;
  const { paid, from, to } = req.query;

  const workshop = await Workshop.findById(workshopId).lean();
  if (!workshop) return error(res, "الورشة غير موجودة", 404);

  let orders = workshop.orders || [];

  if (paid === "true" || paid === "false") {
    const isPaid = paid === "true";
    orders = orders.filter((o) => o.isPaid === isPaid);
  }
  if (from) {
    const fromDate = new Date(from);
    orders = orders.filter((o) => new Date(o.createdAt) >= fromDate);
  }
  if (to) {
    const toDate = new Date(to);
    orders = orders.filter((o) => new Date(o.createdAt) <= toDate);
  }

  return success(res, { workshopId, workshopName: workshop.name, orders }, "قائمة الطلبيات");
};

// الديون غير المسددة عبر كل الورش (مع فلاتر اختيارية)
exports.getDebts = async (req, res) => {
  const { workshopId, workshopName, from, to } = req.query;
  const matchWorkshops = {};
  if (workshopId) matchWorkshops._id = new mongoose.Types.ObjectId(workshopId);
  if (workshopName) matchWorkshops.name = workshopName;

  const matchOrders = { "orders.isPaid": false };
  if (from) matchOrders["orders.createdAt"] = { ...(matchOrders["orders.createdAt"] || {}), $gte: new Date(from) };
  if (to) matchOrders["orders.createdAt"] = { ...(matchOrders["orders.createdAt"] || {}), $lte: new Date(to) };

  const pipeline = [
    { $match: matchWorkshops },
    { $unwind: "$orders" },
    { $match: matchOrders },
    {
      $project: {
        _id: 0,
        workshopId: "$_id",
        workshopName: "$name",
        orderId: "$orders._id",
        orderName: "$orders.orderName",
        itemsCount: "$orders.itemsCount",
        totalPrice: "$orders.totalPrice",
        isPaid: "$orders.isPaid",
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
      return acc;
    },
    { ordersCount: 0, itemsCount: 0, totalAmount: 0 }
  );

  return success(res, { debts, totals }, "الديون غير المسددة");
};

// تقارير ملخصة أسبوعية/شهرية/سنوية أو فترة مخصصة
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