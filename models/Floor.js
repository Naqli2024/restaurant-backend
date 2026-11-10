import mongoose from "mongoose";

const floorSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },

    floorName: {
      type: String,
      required: [true, "Floor name is required"],
      trim: true,
    },

    floorCode: {
      type: String,
      required: [true, "Floor code is required"],
      trim: true,
      uppercase: true,
    },

    description: {
      type: String,
      default: "",
      trim: true,
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
  },
  {
    timestamps: true,
  }
);

// Floor codes must be unique within each restaurant.
floorSchema.index(
  { restaurantId: 1, floorCode: 1 },
  { unique: true }
);

const Floor = mongoose.model("Floor", floorSchema);

export default Floor;