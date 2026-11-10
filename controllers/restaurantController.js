import mongoose from "mongoose";
import registerRestaurant from "../services/restaurantService.js";

const createRestaurant = async (req, res) => {
  try {
    const {
      restaurantName,
      ownerName,
      email,
      mobile,
      username,
      password,
      address,
      gstNo,
    } = req.body;

    // 1. Validate required fields.
    if (
      !restaurantName?.trim() ||
      !ownerName?.trim() ||
      !email?.trim() ||
      !mobile?.trim() ||
      !username?.trim() ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Restaurant name, owner name, email, mobile, username, and password are required.",
      });
    }

    // 2. Validate password length.
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must contain at least 8 characters.",
      });
    }

    // 3. Normalize inputs.
    const data = {
      restaurantName: restaurantName.trim(),
      ownerName: ownerName.trim(),
      email: email.trim().toLowerCase(),
      mobile: mobile.trim(),
      username: username.trim().toLowerCase(),
      password,
      address: address?.trim() || "",
      gstNo: gstNo?.trim().toUpperCase() || "",
    };

    // 4. Create restaurant, ADMIN role, and initial admin.
    const result = await registerRestaurant(data);

    return res.status(201).json({
      success: true,
      message: "Restaurant and initial admin registered successfully.",
      data: result,
    });
  } catch (error) {
    console.error("Restaurant registration error:", error);

    // Handle duplicate values from MongoDB unique indexes.
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];

      const messages = {
        email: "This email is already registered.",
        mobile: "This mobile number is already registered.",
        gstNo: "This GST number is already registered.",
        username: "This username is already registered for this restaurant.",
        code: "This role already exists for this restaurant.",
      };

      return res.status(409).json({
        success: false,
        message: messages[field] || "A duplicate value already exists.",
        field,
      });
    }

    if (error instanceof mongoose.Error.ValidationError) {
      return res.status(400).json({
        success: false,
        message: "Validation failed.",
        errors: Object.values(error.errors).map(
          (item) => item.message
        ),
      });
    }

    return res.status(500).json({
      success: false,
      message: "Unable to register restaurant.",
    });
  }
};

export { createRestaurant };