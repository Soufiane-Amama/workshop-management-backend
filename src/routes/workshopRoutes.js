// src/routes/workshopRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/workshopController");

// ورش
router.post("/", ctrl.createWorkshop);
router.get("/", ctrl.getWorkshops);
router.get("/:workshopId", ctrl.getWorkshopById);
router.patch("/:workshopId", ctrl.updateWorkshop);

// طلبيات
router.post("/:workshopId/orders", ctrl.addOrder);
router.get("/:workshopId/orders", ctrl.listOrdersForWorkshop);
router.patch("/:workshopId/orders/:orderId", ctrl.updateOrder);
router.delete("/:workshopId/orders/:orderId", ctrl.deleteOrder);

// دفعات
router.post("/:workshopId/orders/:orderId/payments", ctrl.addPayment); // دفعة جزئية
router.patch("/:workshopId/orders/:orderId/pay", ctrl.payOrder); // تسديد كامل المتبقي (توافق)

// إدخال خاص للبوت
router.post("/bot/orders", ctrl.botCreateOrderByWorkshopName);

// ديون
router.get("/_meta/debts", ctrl.getDebts);

// تقارير
router.get("/_meta/reports", ctrl.getReports); // القديم (ملخص)
router.get("/_meta/reports/weekly-structured", ctrl.getWeeklyStructured);
router.get("/_meta/reports/monthly-structured", ctrl.getMonthlyStructured);
router.get("/_meta/reports/yearly-structured", ctrl.getYearlyStructured);

module.exports = router;









// // src/routes/workshopRoutes.js
// const express = require("express");
// const router = express.Router();
// const ctrl = require("../controllers/workshopController");

// // ورش
// router.post("/", ctrl.createWorkshop);
// router.get("/", ctrl.getWorkshops);
// router.get("/:workshopId", ctrl.getWorkshopById);
// router.patch("/:workshopId", ctrl.updateWorkshop);

// // طلبيات ضمن ورشة
// router.post("/:workshopId/orders", ctrl.addOrder);
// router.get("/:workshopId/orders", ctrl.listOrdersForWorkshop);
// router.patch("/:workshopId/orders/:orderId", ctrl.updateOrder);
// router.delete("/:workshopId/orders/:orderId", ctrl.deleteOrder);
// router.patch("/:workshopId/orders/:orderId/pay", ctrl.payOrder);

// // إدخال خاص للبوت باسم الورشة مباشرة
// router.post("/bot/orders", ctrl.botCreateOrderByWorkshopName);

// // الديون
// router.get("/_meta/debts", ctrl.getDebts);

// // تقارير
// router.get("/_meta/reports", ctrl.getReports);

// module.exports = router;
