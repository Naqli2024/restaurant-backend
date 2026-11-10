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

    customerName: {
      type: String,
      required: true,
      trim: true,
    },

    numberOfGuests: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "Number of guests must be a whole number",
      },
    },

    captainId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

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

        // One item's selling price before GST
        unitPrice: {
          type: Number,
          required: true,
          min: 0,
        },

        // Quantity multiplied by unit price
        itemSubTotal: {
          type: Number,
          required: true,
          min: 0,
        },

        // GST percentage copied from FoodMenu
        gstRate: {
          type: Number,
          required: true,
          min: 0,
          max: 100,
        },

        // GST amount for this item
        gstAmount: {
          type: Number,
          required: true,
          min: 0,
        },

        // Item subtotal + GST
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

    // Total of all items before GST
    subTotal: {
      type: Number,
      required: true,
      min: 0,
    },

    // Total GST for the order
    totalGst: {
      type: Number,
      required: true,
      min: 0,
    },

    // Subtotal + total GST
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    orderStatus: {
      type: String,
      enum: ["Active", "Completed", "Cancelled"],
      default: "Active",
    },

    seatingStatus: {
      type: String,
      enum: ["Seated", "Left"],
      default: "Seated",
    },

    paymentStatus: {
      type: String,
      enum: ["Unpaid", "Partially Paid", "Paid"],
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

// Useful indexes for restaurant-wise order listing
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

orderSchema.index({
  restaurantId: 1,
  kotStatus: 1,
  createdAt: -1,
});

const Order = mongoose.model("Order", orderSchema);

export default Order;
