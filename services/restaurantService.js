import mongoose from "mongoose";
import bcrypt from "bcryptjs";

import Restaurant from "../models/Restaurant.js";
import User from "../models/User.js";
import Role from "../models/Role.js";
import { initializeDefaultRoles } from "./roleService.js";

const registerRestaurant = async (data) => {
  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      // 1. Create the restaurant.
      const [restaurant] = await Restaurant.create(
        [
          {
            restaurantName: data.restaurantName,
            ownerName: data.ownerName,
            email: data.email,
            mobile: data.mobile,
            address: data.address || "",
            gstNo: data.gstNo || "",
          },
        ],
        { session },
      );

      // 2. Create the restaurant's initial ADMIN role.
      await initializeDefaultRoles(restaurant._id, session);

      // 3. Retrieve the ADMIN role for the initial admin account.
      const adminRole = await Role.findOne({
        restaurantId: restaurant._id,
        code: "ADMIN",
        isActive: true,
      }).session(session);

      if (!adminRole) {
        throw new Error("Administrator role initialization failed.");
      }

      // 4. Hash the admin password.
      const hashedPassword = await bcrypt.hash(data.password, 12);

      // 5. Create the first admin account.
      const [admin] = await User.create(
        [
          {
            restaurantId: restaurant._id,
            username: data.username,
            email: data.email,
            password: hashedPassword,
            roleId: adminRole._id,
            isActive: true,
          },
        ],
        { session },
      );

      result = {
        restaurant: {
          id: restaurant._id,
          restaurantName: restaurant.restaurantName,
          ownerName: restaurant.ownerName,
          email: restaurant.email,
          mobile: restaurant.mobile,
        },

        admin: {
          id: admin._id,
          username: admin.username,
          email: admin.email,
          role: adminRole.code,
        },
      };
    });

    return result;
  } finally {
    await session.endSession();
  }
};

export default registerRestaurant;
