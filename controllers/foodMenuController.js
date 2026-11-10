import mongoose from "mongoose";
import FoodMenu from "../models/FoodMenu.js";
import MenuCategory from "../models/MenuCategory.js";
import KitchenStation from "../models/KitchenStation.js";

// ADMIN-only check
const isAdmin = (req, res) => {
  if (req.user?.roleCode !== "ADMIN") {
    res.status(403).json({
      success: false,
      message: "Only administrators can manage food menu items.",
    });

    return false;
  }

  return true;
};

// 1. CREATE FOOD MENU ITEM
// POST /api/food-menu

export const createFoodMenu = async (req, res) => {
  try {
    if (!isAdmin(req, res)) return;

    const restaurantId = req.user.restaurantId;

    const {
      categoryId,
      kitchenStationId,
      itemName,
      description,
      foodType,
      price,
      gstRate,
      image,
      availableFor,
      displayOrder,
    } = req.body;

    if (!categoryId || !mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({
        success: false,
        message: "Valid menu category is required.",
      });
    }

    // Validate kitchen station ID
    if (!kitchenStationId || !mongoose.isValidObjectId(kitchenStationId)) {
      return res.status(400).json({
        success: false,
        message: "Please select a valid kitchen station.",
      });
    }

    // Verify kitchen station belongs to this restaurant and is active
    const kitchenStation = await KitchenStation.findOne({
      _id: kitchenStationId,
      restaurantId,
      isActive: true,
    });

    if (!kitchenStation) {
      return res.status(400).json({
        success: false,
        message: "Selected kitchen station is invalid or inactive.",
      });
    }

    if (typeof itemName !== "string" || !itemName.trim()) {
      return res.status(400).json({
        success: false,
        message: "Food item name is required.",
      });
    }

    if (!["Veg", "Non-Veg", "Egg"].includes(foodType)) {
      return res.status(400).json({
        success: false,
        message: "Food type must be Veg, Non-Veg or Egg.",
      });
    }

    if (
      price === undefined ||
      price === null ||
      price === "" ||
      !Number.isFinite(Number(price)) ||
      Number(price) < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid food item price.",
      });
    }

    if (
      gstRate !== undefined &&
      (!Number.isFinite(Number(gstRate)) ||
        Number(gstRate) < 0 ||
        Number(gstRate) > 100)
    ) {
      return res.status(400).json({
        success: false,
        message: "GST rate must be between 0 and 100.",
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

    const validOrderTypes = ["Dine-In", "Takeaway", "Delivery"];

    if (
      availableFor !== undefined &&
      (!Array.isArray(availableFor) ||
        availableFor.length === 0 ||
        availableFor.some((type) => !validOrderTypes.includes(type)) ||
        new Set(availableFor).size !== availableFor.length)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Available for must contain valid order types: Dine-In, Takeaway or Delivery.",
      });
    }

    // Check that the category belongs to this restaurant and is active.
    const category = await MenuCategory.findOne({
      _id: categoryId,
      restaurantId,
      isActive: true,
    });

    if (!category) {
      return res.status(400).json({
        success: false,
        message: "Selected menu category is invalid or inactive.",
      });
    }

    // Check duplicate food item name within this restaurant.
    const existingItem = await FoodMenu.findOne({
      restaurantId,
      itemName: itemName.trim(),
    }).collation({ locale: "en", strength: 2 });

    if (existingItem) {
      return res.status(409).json({
        success: false,
        message: "This food item already exists.",
      });
    }

    const foodMenu = await FoodMenu.create({
      restaurantId,
      categoryId,
      kitchenStationId,
      itemName: itemName.trim(),
      description: description || "",
      foodType,
      price: Number(price),
      gstRate: gstRate === undefined ? 5 : Number(gstRate),
      image: image || "",
      availableFor: availableFor ?? ["Dine-In", "Takeaway", "Delivery"],
      displayOrder: displayOrder ?? 0,
    });

    return res.status(201).json({
      success: true,
      message: "Food menu item created successfully.",
      data: foodMenu,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "This food item already exists.",
      });
    }

    console.error("Create food menu error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create food menu item.",
    });
  }
};

// 2. GET FOOD MENU ITEMS
// GET /api/food-menu

export const getFoodMenus = async (req, res) => {
  try {
    const restaurantId = req.user.restaurantId;

    const isAdministrator = req.user.roleCode === "ADMIN";

    const filter = { restaurantId };

    // Non-admin users (such as captains) should only see
    // active and currently available food items.
    if (!isAdministrator) {
      filter.isActive = true;
      filter.isAvailable = true;

      // Also exclude food items under inactive categories.
      const activeCategories = await MenuCategory.find({
        restaurantId,
        isActive: true,
      }).select("_id");

      filter.categoryId = {
        $in: activeCategories.map((category) => category._id),
      };
    }

    if (req.query.categoryId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.categoryId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid category ID.",
        });
      }

      if (!isAdministrator) {
        const categoryExists = await MenuCategory.findOne({
          _id: req.query.categoryId,
          restaurantId,
          isActive: true,
        });

        if (!categoryExists) {
          return res.status(200).json({
            success: true,
            count: 0,
            data: [],
          });
        }
      }

      filter.categoryId = req.query.categoryId;
    }

    // Optional search by food item name.
    if (req.query.search) {
      filter.itemName = {
        $regex: req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        $options: "i",
      };
    }

    // Optional order type filter.
    if (req.query.orderType) {
      const validOrderTypes = ["Dine-In", "Takeaway", "Delivery"];

      if (!validOrderTypes.includes(req.query.orderType)) {
        return res.status(400).json({
          success: false,
          message: "Invalid order type.",
        });
      }

      filter.availableFor = req.query.orderType;
    }

    const foodMenus = await FoodMenu.find(filter)
      .populate("categoryId", "categoryName")
      .sort({ displayOrder: 1, itemName: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: foodMenus.length,
      data: foodMenus,
    });
  } catch (error) {
    console.error("Get food menus error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch food menu items.",
    });
  }
};


// 3. UPDATE FOOD MENU ITEM
// PUT /api/food-menu/:id

export const updateFoodMenu = async (req, res) => {
  try {
    if (!isAdmin(req, res)) return;

    const restaurantId = req.user.restaurantId;
    const { id } = req.params;

    const {
      categoryId,
      kitchenStationId,
      itemName,
      description,
      foodType,
      price,
      gstRate,
      image,
      availableFor,
      displayOrder,
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid food menu item ID.",
      });
    }

    if (
      categoryId !== undefined &&
      !mongoose.Types.ObjectId.isValid(categoryId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid menu category ID.",
      });
    }

    if (
      itemName !== undefined &&
      (typeof itemName !== "string" || !itemName.trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "Food item name cannot be empty.",
      });
    }

    if (
      foodType !== undefined &&
      !["Veg", "Non-Veg", "Egg"].includes(foodType)
    ) {
      return res.status(400).json({
        success: false,
        message: "Food type must be Veg, Non-Veg or Egg.",
      });
    }

    if (
      price !== undefined &&
      (price === null ||
        price === "" ||
        !Number.isFinite(Number(price)) ||
        Number(price) < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid food item price.",
      });
    }

    if (
      gstRate !== undefined &&
      (!Number.isFinite(Number(gstRate)) ||
        Number(gstRate) < 0 ||
        Number(gstRate) > 100)
    ) {
      return res.status(400).json({
        success: false,
        message: "GST rate must be between 0 and 100.",
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

    const validOrderTypes = ["Dine-In", "Takeaway", "Delivery"];

    if (
      availableFor !== undefined &&
      (!Array.isArray(availableFor) ||
        availableFor.length === 0 ||
        availableFor.some((type) => !validOrderTypes.includes(type)) ||
        new Set(availableFor).size !== availableFor.length)
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide valid available order types.",
      });
    }

    // Find existing food menu item within this restaurant.
    const foodMenu = await FoodMenu.findOne({
      _id: id,
      restaurantId,
    });

    if (!foodMenu) {
      return res.status(404).json({
        success: false,
        message: "Food menu item not found.",
      });
    }

    // Update category if supplied.
    if (categoryId !== undefined) {
      const category = await MenuCategory.findOne({
        _id: categoryId,
        restaurantId,
        isActive: true,
      });

      if (!category) {
        return res.status(400).json({
          success: false,
          message: "Selected menu category is invalid or inactive.",
        });
      }

      foodMenu.categoryId = categoryId;
    }

    // Update kitchen station if supplied.
    if (kitchenStationId !== undefined) {
      if (!mongoose.isValidObjectId(kitchenStationId)) {
        return res.status(400).json({
          success: false,
          message: "Please select a valid kitchen station.",
        });
      }

      const kitchenStation = await KitchenStation.findOne({
        _id: kitchenStationId,
        restaurantId,
        isActive: true,
      });

      if (!kitchenStation) {
        return res.status(400).json({
          success: false,
          message: "Selected kitchen station is invalid or inactive.",
        });
      }

      foodMenu.kitchenStationId = kitchenStation._id;
    }

    // Check duplicate food item name.
    if (itemName !== undefined) {
      const existingItem = await FoodMenu.findOne({
        _id: { $ne: id },
        restaurantId,
        itemName: itemName.trim(),
      }).collation({ locale: "en", strength: 2 });

      if (existingItem) {
        return res.status(409).json({
          success: false,
          message: "This food item already exists.",
        });
      }

      foodMenu.itemName = itemName.trim();
    }

    // Update other fields if supplied.
    if (description !== undefined) foodMenu.description = description;
    if (foodType !== undefined) foodMenu.foodType = foodType;
    if (price !== undefined) foodMenu.price = Number(price);
    if (gstRate !== undefined) foodMenu.gstRate = Number(gstRate);
    if (image !== undefined) foodMenu.image = image;
    if (availableFor !== undefined) foodMenu.availableFor = availableFor;

    if (displayOrder !== undefined) {
      foodMenu.displayOrder = displayOrder;
    }

    await foodMenu.save();

    return res.status(200).json({
      success: true,
      message: "Food menu item updated successfully.",
      data: foodMenu,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "This food item already exists.",
      });
    }

    console.error("Update food menu error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update food menu item.",
    });
  }
};


// 4. ACTIVATE / DEACTIVATE FOOD MENU ITEM
// PATCH /api/food-menu/:id/status

export const updateFoodMenuStatus = async (req, res) => {
  try {
    if (!isAdmin(req, res)) return;

    const restaurantId = req.user.restaurantId;
    const { id } = req.params;
    const { isActive } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid food menu item ID.",
      });
    }

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isActive must be true or false.",
      });
    }

    const foodMenu = await FoodMenu.findOne({
      _id: id,
      restaurantId,
    });

    if (!foodMenu) {
      return res.status(404).json({
        success: false,
        message: "Food menu item not found.",
      });
    }

    foodMenu.isActive = isActive;

    await foodMenu.save();

    return res.status(200).json({
      success: true,
      message: `Food menu item ${
        isActive ? "activated" : "deactivated"
      } successfully.`,
      data: foodMenu,
    });
  } catch (error) {
    console.error("Update food menu status error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update food menu status.",
    });
  }
};

// 5. MARK FOOD ITEM AVAILABLE / UNAVAILABLE
// PATCH /api/food-menu/:id/availability

export const updateFoodMenuAvailability = async (req, res) => {
  try {
    if (!isAdmin(req, res)) return;

    const restaurantId = req.user.restaurantId;
    const { id } = req.params;
    const { isAvailable } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid food menu item ID.",
      });
    }

    if (typeof isAvailable !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isAvailable must be true or false.",
      });
    }

    const foodMenu = await FoodMenu.findOne({
      _id: id,
      restaurantId,
    });

    if (!foodMenu) {
      return res.status(404).json({
        success: false,
        message: "Food menu item not found.",
      });
    }

    foodMenu.isAvailable = isAvailable;

    await foodMenu.save();

    return res.status(200).json({
      success: true,
      message: `Food menu item marked ${
        isAvailable ? "available" : "unavailable"
      } successfully.`,
      data: foodMenu,
    });
  } catch (error) {
    console.error("Update food menu availability error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update food menu availability.",
    });
  }
};
