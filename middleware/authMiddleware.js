import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Restaurant from "../models/Restaurant.js";
import Role from "../models/Role.js";

const authMiddleware = async (req, res, next) => {
  try {
    // Get token from cookie
    let token = req.cookies?.restaurantToken;

    // Support Authorization: Bearer <token>
    if (!token && req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. Please log in.",
      });
    }

    // Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.userId || !decoded.restaurantId) {
      return res.status(401).json({
        success: false,
        message: "Invalid access token.",
      });
    }

    // Find active user belonging to the restaurant in the token
    const user = await User.findOne({
      _id: decoded.userId,
      restaurantId: decoded.restaurantId,
      isActive: true,
    }).select("-password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found or account is inactive.",
      });
    }

    // Verify restaurant is active
    const restaurant = await Restaurant.findOne({
      _id: user.restaurantId,
      isActive: true,
    });

    if (!restaurant) {
      return res.status(403).json({
        success: false,
        message: "Restaurant account is inactive.",
      });
    }

    // Verify role belongs to the same restaurant
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

    // Attach authenticated information to request
    req.user = {
      userId: user._id.toString(),
      restaurantId: user.restaurantId.toString(),
      username: user.username,
      roleId: role._id.toString(),
      roleCode: role.code,
      permissions: role.permissions,
    };

    next();
  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError" ||
      error.name === "NotBeforeError"
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired access token.",
      });
    }

    console.error("Authentication error:", error);

    return res.status(500).json({
      success: false,
      message: "Authentication failed.",
    });
  }
};

export default authMiddleware;