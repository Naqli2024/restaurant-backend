import mongoose from "mongoose";

const foodMenuSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },

    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MenuCategory",
      required: true,
    },

    kitchenStationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "KitchenStation",
      required: true,
    },

    itemName: {
      type: String,
      required: [true, "Food item name is required"],
      trim: true,
    },

    description: {
      type: String,
      default: "",
      trim: true,
    },

    foodType: {
      type: String,
      enum: ["Veg", "Non-Veg", "Egg"],
      required: true,
    },

    price: {
      type: Number,
      required: [true, "Selling price is required"],
      min: [0, "Price cannot be negative"],
    },

    gstRate: {
      type: Number,
      required: true,
      min: [0, "GST rate cannot be negative"],
      max: [100, "GST rate cannot exceed 100"],
      default: 5,
    },

    image: {
      type: String,
      default: "",
      trim: true,
    },

    availableFor: {
      type: [
        {
          type: String,
          enum: ["Dine-In", "Takeaway", "Delivery"],
        },
      ],
      default: ["Dine-In", "Takeaway", "Delivery"],
    },

    isAvailable: {
      type: Boolean,
      default: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    displayOrder: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true },
);

// Food item names must be unique within each restaurant,
// ignoring uppercase/lowercase differences.
foodMenuSchema.index(
  { restaurantId: 1, itemName: 1 },
  {
    unique: true,
    collation: { locale: "en", strength: 2 },
  },
);

foodMenuSchema.index({ restaurantId: 1, categoryId: 1 });

const FoodMenu = mongoose.model("FoodMenu", foodMenuSchema);

export default FoodMenu;
