import mongoose from "mongoose";

const roleSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: [true, "Role name is required"],
      trim: true,
    },

    code: {
      type: String,
      required: [true, "Role code is required"],
      trim: true,
      uppercase: true,
    },

    description: {
      type: String,
      default: "",
      trim: true,
    },

    permissions: [
      {
        module: {
          type: String,
          required: true,
        },

        actions: [
          {
            type: String,
            enum: [
              "create",
              "read",
              "update",
              "delete",
              "approve",
              "export",
            ],
          },
        ],
      },
    ],

    isSystemRole: {
      type: Boolean,
      default: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// A role code must be unique within a restaurant.
roleSchema.index(
  { restaurantId: 1, code: 1 },
  { unique: true }
);

const Role = mongoose.model("Role", roleSchema);

export default Role;