import mongoose from "mongoose";
import MenuCategory from "../models/MenuCategory.js";

// ADMIN-only check
const isAdmin = (req, res) => {
  if (req.user?.roleCode !== "ADMIN") {
    res.status(403).json({
      success: false,
      message: "Only administrators can manage menu categories.",
    });

    return false;
  }

  return true;
};

// 1. CREATE MENU CATEGORY
// POST /api/menu-categories

export const createMenuCategory = async (req, res) => {
  try {
    if (!isAdmin(req, res)) return;

    const restaurantId = req.user.restaurantId;

    const { categoryName, description, displayOrder } = req.body;

    if (!categoryName || !categoryName.trim()) {
      return res.status(400).json({
        success: false,
        message: "Category name is required.",
      });
    }

    if (
      displayOrder !== undefined &&
      (!Number.isInteger(displayOrder) || displayOrder < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Display order must be a non-negative integer.",
      });
    }

    // Check whether the category already exists.
    const existingCategory = await MenuCategory.findOne({
      restaurantId,
      categoryName: categoryName.trim(),
    }).collation({ locale: "en", strength: 2 });

    if (existingCategory) {
      return res.status(409).json({
        success: false,
        message: "This menu category already exists.",
      });
    }

    const category = await MenuCategory.create({
      restaurantId,
      categoryName: categoryName.trim(),
      description: description || "",
      displayOrder: displayOrder ?? 0,
    });

    return res.status(201).json({
      success: true,
      message: "Menu category created successfully.",
      data: category,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "This menu category already exists.",
      });
    }

    console.error("Create menu category error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create menu category.",
    });
  }
};


// 2. GET ALL MENU CATEGORIES
// GET /api/menu-categories

export const getMenuCategories = async (req, res) => {
  try {
    const restaurantId = req.user.restaurantId;

    const categories = await MenuCategory.find({ restaurantId })
      .sort({ displayOrder: 1, categoryName: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: categories.length,
      data: categories,
    });
  } catch (error) {
    console.error("Get menu categories error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch menu categories.",
    });
  }
};


// 3. UPDATE MENU CATEGORY
// PUT /api/menu-categories/:id

export const updateMenuCategory = async (req, res) => {
  try {
    if (!isAdmin(req, res)) return;

    const restaurantId = req.user.restaurantId;
    const { id } = req.params;

    const { categoryName, description, displayOrder } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category ID.",
      });
    }

    if (
      categoryName !== undefined &&
      (typeof categoryName !== "string" || !categoryName.trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "Category name cannot be empty.",
      });
    }

    if (
      displayOrder !== undefined &&
      (!Number.isInteger(displayOrder) || displayOrder < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Display order must be a non-negative integer.",
      });
    }

    const category = await MenuCategory.findOne({
      _id: id,
      restaurantId,
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Menu category not found.",
      });
    }

    if (categoryName !== undefined) {
      const existingCategory = await MenuCategory.findOne({
        _id: { $ne: id },
        restaurantId,
        categoryName: categoryName.trim(),
      }).collation({ locale: "en", strength: 2 });

      if (existingCategory) {
        return res.status(409).json({
          success: false,
          message: "This menu category already exists.",
        });
      }

      category.categoryName = categoryName.trim();
    }

    if (description !== undefined) {
      category.description = description;
    }

    if (displayOrder !== undefined) {
      category.displayOrder = displayOrder;
    }

    await category.save();

    return res.status(200).json({
      success: true,
      message: "Menu category updated successfully.",
      data: category,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "This menu category already exists.",
      });
    }

    console.error("Update menu category error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update menu category.",
    });
  }
};


// 4. ACTIVATE / DEACTIVATE MENU CATEGORY
// PATCH /api/menu-categories/:id/status

export const updateMenuCategoryStatus = async (req, res) => {
  try {
    if (!isAdmin(req, res)) return;

    const restaurantId = req.user.restaurantId;
    const { id } = req.params;
    const { isActive } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category ID.",
      });
    }

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isActive must be true or false.",
      });
    }

    const category = await MenuCategory.findOne({
      _id: id,
      restaurantId,
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Menu category not found.",
      });
    }

    category.isActive = isActive;

    await category.save();

    return res.status(200).json({
      success: true,
      message: `Menu category ${
        isActive ? "activated" : "deactivated"
      } successfully.`,
      data: category,
    });
  } catch (error) {
    console.error("Update menu category status error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update menu category status.",
    });
  }
};