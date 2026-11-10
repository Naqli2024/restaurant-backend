import mongoose from "mongoose";

const menuCategorySchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },

    categoryName: {
      type: String,
      required: [true, "Category name is required"],
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
  { timestamps: true }
);

// Prevent duplicate category names within the same restaurant,
// ignoring uppercase/lowercase differences.
menuCategorySchema.index(
  { restaurantId: 1, categoryName: 1 },
  {
    unique: true,
    collation: { locale: "en", strength: 2 },
  }
);

const MenuCategory = mongoose.model("MenuCategory", menuCategorySchema);

export default MenuCategory;