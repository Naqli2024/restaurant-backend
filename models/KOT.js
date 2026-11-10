import mongoose from "mongoose";

const kotItemSchema = new mongoose.Schema(
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
    },

    specialInstructions: {
      type: String,
      default: "",
      trim: true,
    },

    itemStatus: {
      type: String,
      enum: ["New", "Preparing", "Ready", "Served", "Cancelled"],
      default: "New",
    },
  },
  { timestamps: true }
);

const kotSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },

    kotNumber: {
      type: String,
      required: true,
      trim: true,
    },

    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },

    kitchenStationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "KitchenStation",
      required: true,
    },

    // Keep the station name and code as snapshots.
    kitchenStationName: {
      type: String,
      required: true,
    },

    kitchenStationCode: {
      type: String,
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
      default: "",
      trim: true,
    },

    numberOfGuests: {
      type: Number,
      default: 1,
      min: 1,
    },

    captainId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    items: {
      type: [kotItemSchema],
      validate: {
        validator: (items) => items.length > 0,
        message: "A KOT must contain at least one item.",
      },
    },

    kotStatus: {
      type: String,
      enum: ["New", "Preparing", "Ready", "Served", "Cancelled"],
      default: "New",
    },

    startedAt: {
      type: Date,
      default: null,
    },

    readyAt: {
      type: Date,
      default: null,
    },

    servedAt: {
      type: Date,
      default: null,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// KOT number must be unique within a restaurant.
kotSchema.index(
  { restaurantId: 1, kotNumber: 1 },
  { unique: true }
);

// Helps kitchen screens retrieve tickets by station and status.
kotSchema.index({
  restaurantId: 1,
  kitchenStationId: 1,
  kotStatus: 1,
  createdAt: 1,
});

// Helps retrieve all KOTs belonging to an order.
kotSchema.index({
  restaurantId: 1,
  orderId: 1,
});

const KOT = mongoose.model("KOT", kotSchema);

export default KOT;