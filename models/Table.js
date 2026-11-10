import mongoose from "mongoose";

const tableSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },

    floorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Floor",
      required: true,
    },

    tableName: {
      type: String,
      required: [true, "Table name is required"],
      trim: true,
    },

    seatingCapacity: {
      type: Number,
      required: [true, "Seating capacity is required"],
      min: [1, "Seating capacity must be at least 1"],
      validate: {
        validator: Number.isInteger,
        message: "Seating capacity must be a whole number",
      },
    },

    displayOrder: {
      type: Number,
      default: 0,
      min: 0,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    occupancyStatus: {
      type: String,
      enum: ["Available", "Partially Occupied", "Fully Occupied"],
      default: "Available",
    },

    occupiedSeats: {
      type: Number,
      default: 0,
      min: 0,
    },

    currentOrderIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order",
      },
    ],
  },
  {
    timestamps: true,
  },
);

// Table names must be unique within a floor of a restaurant.
tableSchema.index(
  { restaurantId: 1, floorId: 1, tableName: 1 },
  { unique: true },
);

const Table = mongoose.model("Table", tableSchema);

export default Table;
