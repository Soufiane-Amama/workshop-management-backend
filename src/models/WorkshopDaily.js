// src/models/WorkshopDaily.js
const mongoose = require("mongoose");

const workshopDailySchema = new mongoose.Schema(
  {
    workshop: { type: mongoose.Schema.Types.ObjectId, ref: "Workshop", required: true },
    day: { type: Date, required: true },            // بداية اليوم بتوقيت TZ محفوظة كـ Date (UTC)
    dayKey: { type: String, required: true },       // YYYY-MM-DD (بحسب TZ)
    ordersCount: { type: Number, default: 0, min: 0 },
    dayDebt: { type: Number, default: 0, min: 0 },  // الدين المُسجّل لذلك اليوم (إجمالي)
    dayPaid: { type: Number, default: 0, min: 0 },  // المبلغ المدفوع ذلك اليوم (قد يغطي أديان سابقة)
    note: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

workshopDailySchema.index({ workshop: 1, dayKey: 1 }, { unique: true });
workshopDailySchema.index({ day: 1 });
workshopDailySchema.index({ workshop: 1 });

workshopDailySchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
  },
});

module.exports = mongoose.model("WorkshopDaily", workshopDailySchema, "workshop_dailies");