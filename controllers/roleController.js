import Role from "../models/Role.js";
import { initializeDefaultRoles } from "../services/roleService.js";

// GET /api/roles
export const getRoles = async (req, res) => {
  try {
    // Get the restaurant ID from the authenticated user.
    const restaurantId = req.user.restaurantId;

    // Find active roles belonging to this restaurant only.
    const roles = await Role.find({
      restaurantId,
      isActive: true,
    }).sort({ name: 1 });

    return res.status(200).json({
      success: true,
      count: roles.length,
      data: roles,
    });
  } catch (error) {
    console.error("Get roles error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve roles.",
    });
  }
};

// POST /api/roles/initialize-defaults
export const initializeRoles = async (req, res) => {
  try {
    // Only restaurant ADMIN can initialize default roles.
    if (req.user.roleCode !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Only the restaurant administrator can initialize roles.",
      });
    }

    const roles = await initializeDefaultRoles(
      req.user.restaurantId
    );

    return res.status(200).json({
      success: true,
      message: "Default roles initialized successfully.",
      count: roles.length,
      data: roles,
    });
  } catch (error) {
    console.error("Initialize roles error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to initialize default roles.",
    });
  }
};