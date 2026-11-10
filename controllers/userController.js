import bcrypt from "bcryptjs";
import User from "../models/User.js";
import Role from "../models/Role.js";

// POST /api/users
export const createEmployee = async (req, res) => {
  try {
    // Only restaurant ADMIN can create employees.
    if (req.user.roleCode !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Only the restaurant administrator can create employees.",
      });
    }

    const { username, email, password, roleId } = req.body;

    // 1. Validate required fields.
    if (!username || !password || !roleId) {
      return res.status(400).json({
        success: false,
        message: "Username, password and roleId are required.",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must contain at least 8 characters.",
      });
    }

    // 2. Get restaurantId from authenticated user.
    const restaurantId = req.user.restaurantId;

    const normalizedUsername = username.trim().toLowerCase();

    // 3. Check whether username already exists.
    const existingUser = await User.findOne({
      username: normalizedUsername,
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Username already exists.",
      });
    }

    // 4. Verify that the selected role belongs to this restaurant.
    const role = await Role.findOne({
      _id: roleId,
      restaurantId,
      isActive: true,
    });

    if (!role) {
      return res.status(400).json({
        success: false,
        message: "Invalid role selected.",
      });
    }

    // 5. Hash employee password.
    const hashedPassword = await bcrypt.hash(password, 12);

    // 6. Create employee account.
    const employee = await User.create({
      restaurantId,
      username: normalizedUsername,
      email: email ? email.trim().toLowerCase() : "",
      password: hashedPassword,
      roleId: role._id,
      isActive: true,
    });

    // 7. Return employee details.
    return res.status(201).json({
      success: true,
      message: "Employee created successfully.",
      data: {
        id: employee._id,
        restaurantId: employee.restaurantId,
        username: employee.username,
        email: employee.email,
        roleId: employee.roleId,
        roleName: role.name,
        roleCode: role.code,
        isActive: employee.isActive,
      },
    });
  } catch (error) {
    console.error("Create employee error:", error);

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Username or another unique field already exists.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create employee.",
    });
  }
};