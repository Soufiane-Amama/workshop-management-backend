// src/models/Workshop.js
const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    at: { type: Date, default: Date.now },
    note: { type: String, trim: true, maxlength: 200 },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderName: { type: String, default: "طلبية" },
    itemsCount: { type: Number, default: 1, min: 1 },
    totalPrice: { type: Number, required: true, min: 0 },
    amountPaid: { type: Number, default: 0, min: 0 },
    payments: { type: [paymentSchema], default: [] },
    createdAt: { type: Date, default: Date.now },
    fullyPaidAt: { type: Date, default: null },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { _id: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// دين محسوب
orderSchema.virtual("debt").get(function () {
  const debt = (this.totalPrice || 0) - (this.amountPaid || 0);
  return debt > 0 ? debt : 0;
});

// مدفوع بالكامل محسوب
orderSchema.virtual("isPaid").get(function () {
  return (this.amountPaid || 0) >= (this.totalPrice || 0);
});

// ضبط fullyPaidAt تلقائيًا
orderSchema.pre("validate", function (next) {
  if (this.amountPaid < 0) this.amountPaid = 0;
  if (this.amountPaid > this.totalPrice) this.amountPaid = this.totalPrice;

  if (this.amountPaid >= this.totalPrice) {
    if (!this.fullyPaidAt) this.fullyPaidAt = new Date();
  } else {
    this.fullyPaidAt = null;
  }
  next();
});

const workshopSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    orders: [orderSchema],
  },
  { timestamps: true }
);

workshopSchema.index({ name: 1 }, { unique: true });
workshopSchema.index({ "orders.createdAt": 1 });
workshopSchema.index({ "orders.totalPrice": 1 });
workshopSchema.index({ "orders.amountPaid": 1 });

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




// // src/models/Workshop.js
// const mongoose = require("mongoose");

// const orderSchema = new mongoose.Schema(
//   {
//     orderName: { type: String, default: "طلبية" },
//     itemsCount: { type: Number, default: 1, min: 1 },
//     totalPrice: { type: Number, required: true, min: 0 },
//     isPaid: { type: Boolean, default: false },
//     createdAt: { type: Date, default: Date.now },
//     paidAt: { type: Date, default: null },
//     notes: { type: String, trim: true, maxlength: 500 },
//   },
//   { _id: true }
// );

// const workshopSchema = new mongoose.Schema(
//   {
//     name: { type: String, required: true, unique: true, trim: true },
//     orders: [orderSchema],
//   },
//   { timestamps: true }
// );

// workshopSchema.index({ name: 1 }, { unique: true });
// workshopSchema.index({ "orders.createdAt": 1 });
// workshopSchema.index({ "orders.isPaid": 1 });

// workshopSchema.set("toJSON", {
//   virtuals: true,
//   versionKey: false,
//   transform: (doc, ret) => {
//     ret.id = ret._id;
//     delete ret._id;
//     if (ret.orders && Array.isArray(ret.orders)) {
//       ret.orders = ret.orders.map((o) => {
//         const { _id, ...rest } = o;
//         return { id: _id, ...rest };
//       });
//     }
//   },
// });

// module.exports = mongoose.model("Workshop", workshopSchema);