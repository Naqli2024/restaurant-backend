import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import User from "../models/User.js";
import Restaurant from "../models/Restaurant.js";
import Role from "../models/Role.js";

export const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username?.trim() || !password) {
      return res.status(400).json({
        success: false,
        message: "Username and password are required.",
      });
    }

    // Find user using username only
    const user = await User.findOne({
      username: username.trim().toLowerCase(),
      isActive: true,
    }).select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password.",
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password.",
      });
    }

    // Get restaurant using the user's restaurantId
    const restaurant = await Restaurant.findOne({
      _id: user.restaurantId,
      isActive: true,
    });

    if (!restaurant) {
      return res.status(403).json({
        success: false,
        message: "Restaurant account is inactive or unavailable.",
      });
    }

    // Verify the user's role belongs to the same restaurant
    const role = await Role.findOne({
      _id: user.roleId,
      restaurantId: user.restaurantId,
      isActive: true,
    });

    if (!role) {
      return res.status(403).json({
        success: false,
        message: "User role is invalid or inactive.",
      });
    }

    // Generate JWT containing userId and restaurantId
    const token = jwt.sign(
      {
        userId: user._id.toString(),
        restaurantId: user.restaurantId.toString(),
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || "1d",
      },
    );

    // Update last login
    user.lastLoginAt = new Date();
    await user.save();

    // Store JWT in HTTP-only cookie
    // res.cookie("restaurantToken", token, {
    //   httpOnly: true,
    //   secure: process.env.NODE_ENV === "production",
    //   sameSite:
    //     process.env.NODE_ENV === "production" ? "none" : "lax",
    //   maxAge: 24 * 60 * 60 * 1000,
    //   path: "/",
    // });

    res.cookie("restaurantToken", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 24 * 60 * 60 * 1000,
      path: "/",
    });

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      data: {
        user: {
          userId: user._id,
          username: user.username,
          email: user.email,
          role: role.code,
          permissions: role.permissions,
        },
        restaurant: {
          restaurantId: restaurant._id,
          restaurantName: restaurant.restaurantName,
        },
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      success: false,
      message: "Login failed.",
    });
  }
};

export const logout = (req, res) => {
  try {
    res.clearCookie("restaurantToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/",
    });

    return res.status(200).json({
      success: true,
      message: "Logout successful.",
    });
  } catch (error) {
    console.error("Logout error:", error);

    return res.status(500).json({
      success: false,
      message: "Logout failed.",
    });
  }
};

export const getLoggedInUser = async (req, res) => {
  try {
    // req.user is populated by authMiddleware
    const user = await User.findOne({
      _id: req.user.userId,
      restaurantId: req.user.restaurantId,
      isActive: true,
    })
      .select("-password")
      .populate("roleId", "name code permissions");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    // Fetch the user's restaurant
    const restaurant = await Restaurant.findOne({
      _id: req.user.restaurantId,
      isActive: true,
    }).select("restaurantName ownerName email mobile address gstNo logo");

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: "Restaurant not found or inactive.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Logged-in user details fetched successfully.",
      data: {
        user: {
          userId: user._id,
          username: user.username,
          email: user.email,
          role: user.roleId,
          lastLoginAt: user.lastLoginAt,
        },
        restaurant: {
          restaurantId: restaurant._id,
          restaurantName: restaurant.restaurantName,
          ownerName: restaurant.ownerName,
          email: restaurant.email,
          mobile: restaurant.mobile,
          address: restaurant.address,
          gstNo: restaurant.gstNo,
          logo: restaurant.logo,
        },
      },
    });
  } catch (error) {
    console.error("Get logged-in user error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch logged-in user details.",
    });
  }
};
