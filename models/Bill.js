import mongoose from "mongoose";

const billItemSchema = new mongoose.Schema(
  {
    foodMenuId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FoodMenu",
      default: null,
    },

    itemName: {
      type: String,
      required: true,
      trim: true,
    },

    quantity: {
      type: Number,
      required: true,
      min: 1,
    },

    unitPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    itemSubTotal: {
      type: Number,
      required: true,
      min: 0,
    },

    gstRate: {
      type: Number,
      default: 0,
      min: 0,
    },

    gstAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    specialInstructions: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { _id: true },
);

const billSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },

    billNumber: {
      type: String,
      required: true,
      trim: true,
    },

    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },

    orderType: {
      type: String,
      enum: ["Dine-In", "Takeaway", "Delivery"],
      required: true,
    },

    floorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Floor",
      default: null,
    },

    tableId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Table",
      default: null,
    },

    customerName: {
      type: String,
      required: true,
      trim: true,
    },

    captainId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    items: {
      type: [billItemSchema],
      required: true,
    },

    subTotal: {
      type: Number,
      required: true,
      min: 0,
    },

    totalGst: {
      type: Number,
      required: true,
      min: 0,
    },

    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    billStatus: {
      type: String,
      enum: ["Generated", "Paid", "Cancelled"],
      default: "Generated",
    },

    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    generatedAt: {
      type: Date,
      default: Date.now,
    },

    paymentMethod: {
      type: String,
      enum: ["Cash", "UPI", "Card", "Other", "Mixed"],
      default: null,
    },

    paymentDetails: [
      {
        paymentMethod: {
          type: String,
          enum: ["Cash", "UPI", "Card", "Other"],
          required: true,
        },
        amount: {
          type: Number,
          required: true,
          min: 0.01,
        },
      },
    ],

    paidAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    paidAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

// One bill per order within a restaurant
billSchema.index({ restaurantId: 1, orderId: 1 }, { unique: true });

// Bill numbers must be unique within a restaurant
billSchema.index({ restaurantId: 1, billNumber: 1 }, { unique: true });

const Bill = mongoose.model("Bill", billSchema);

export default Bill;
