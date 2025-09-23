// src/models/Workshop.js
const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    orderName: { type: String, default: "طلبية" },
    itemsCount: { type: Number, default: 1, min: 1 },
    totalPrice: { type: Number, required: true, min: 0 },
    isPaid: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    paidAt: { type: Date, default: null },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { _id: true }
);

const workshopSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    orders: [orderSchema],
  },
  { timestamps: true }
);

workshopSchema.index({ name: 1 }, { unique: true });
workshopSchema.index({ "orders.createdAt": 1 });
workshopSchema.index({ "orders.isPaid": 1 });

workshopSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    if (ret.orders && Array.isArray(ret.orders)) {
      ret.orders = ret.orders.map((o) => {
        const { _id, ...rest } = o;
        return { id: _id, ...rest };
      });
    }
  },
});

module.exports = mongoose.model("Workshop", workshopSchema);