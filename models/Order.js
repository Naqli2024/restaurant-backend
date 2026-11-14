
import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },

    orderType: {
      type: String,
      enum: ["Dine-In", "Takeaway", "Delivery"],
      required: true,
      default: "Dine-In",
    },

    // Dine-In details
    floorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Floor",
      default: null,
      required: function () {
        return this.orderType === "Dine-In";
      },
    },

    tableId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Table",
      default: null,
      required: function () {
        return this.orderType === "Dine-In";
      },
    },

    numberOfGuests: {
      type: Number,
      default: null,
      required: function () {
        return this.orderType === "Dine-In";
      },
      min: 1,
      validate: {
        validator: function (value) {
          return value == null || Number.isInteger(value);
        },
        message: "Number of guests must be a whole number",
      },
    },

    // Customer details
    customerName: {
      type: String,
      required: true,
      trim: true,
    },

    customerMobile: {
      type: String,
      trim: true,
      required: function () {
        return ["Takeaway", "Delivery"].includes(this.orderType);
      },
    },

    // Delivery details
    deliveryAddress: {
      type: String,
      default: "",
      trim: true,
      required: function () {
        return this.orderType === "Delivery";
      },
    },

    deliveryChannel: {
      type: String,
      trim: true,
      default: "Direct",
    },

    deliveryCharges: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Assigned Captain (required only for Dine-In)
    captainId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      required: function () {
        return this.orderType === "Dine-In";
      },
    },

    // User who actually created the order
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // Food items
    items: [
      {
        foodMenuId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "FoodMenu",
          required: true,
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
          validate: {
            validator: Number.isInteger,
            message: "Quantity must be a whole number",
          },
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
          required: true,
          min: 0,
          max: 100,
        },

        gstAmount: {
          type: Number,
          required: true,
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
    ],

    // Order totals
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

    // Delivery and Takeaway fulfilment tracking
    fulfilmentStatus: {
      type: String,
      enum: [
        "Not Applicable",
        "Pending",
        "Preparing",
        "Ready",
        "Dispatched",
        "Handed Over",
        "Delivered",
      ],
      default: function () {
        return this.orderType === "Dine-In"
          ? "Not Applicable"
          : "Pending";
      },
    },

    orderStatus: {
      type: String,
      enum: ["Active", "Completed", "Cancelled"],
      default: "Active",
    },

    seatingStatus: {
      type: String,
      enum: ["Not Applicable", "Seated", "Left"],
      default: function () {
        return this.orderType === "Dine-In"
          ? "Seated"
          : "Not Applicable";
      },
    },

    paymentStatus: {
      type: String,
      enum: [
        "Unpaid",
        "Not Requested",
        "Bill Requested",
        "Payment Pending",
        "Paid",
      ],
      default: "Unpaid",
    },

    orderedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

// Restaurant-wise order listing
orderSchema.index({
  restaurantId: 1,
  orderStatus: 1,
  createdAt: -1,
});

orderSchema.index({
  restaurantId: 1,
  tableId: 1,
  orderStatus: 1,
});

// Existing index retained for now
orderSchema.index({
  restaurantId: 1,
  kotStatus: 1,
  createdAt: -1,
});

const Order = mongoose.model("Order", orderSchema);

export default Order;
