import mongoose from "mongoose";

const kitchenStationSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: [true, "Kitchen station name is required"],
      trim: true,
    },

    code: {
      type: String,
      required: [true, "Kitchen station code is required"],
      uppercase: true,
      trim: true,
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

// Station names and codes must be unique within each restaurant.
kitchenStationSchema.index(
  { restaurantId: 1, name: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);

kitchenStationSchema.index(
  { restaurantId: 1, code: 1 },
  { unique: true }
);

const KitchenStation = mongoose.model(
  "KitchenStation",
  kitchenStationSchema
);

export default KitchenStation;