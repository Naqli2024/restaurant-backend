import mongoose from "mongoose";

const restaurantSchema = new mongoose.Schema(
  {
    restaurantName: {
      type: String,
      required: [true, "Restaurant name is required"],
      trim: true,
    },

    ownerName: {
      type: String,
      required: [true, "Owner name is required"],
      trim: true,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
    },

    mobile: {
      type: String,
      required: [true, "Mobile number is required"],
      trim: true,
    },

    address: {
      type: String,
      default: "",
      trim: true,
    },

    gstNo: {
      type: String,
      default: "",
      trim: true,
      uppercase: true,
    },

    logo: {
      type: String,
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

// Email must be unique across restaurant accounts.
restaurantSchema.index({ email: 1 }, { unique: true });

// Mobile must be unique across restaurant accounts.
restaurantSchema.index({ mobile: 1 }, { unique: true });

// GST number must be unique when provided.
restaurantSchema.index(
  { gstNo: 1 },
  {
    unique: true,
    partialFilterExpression: {
      gstNo: { $type: "string", $gt: "" },
    },
  },
);

const Restaurant = mongoose.model("Restaurant", restaurantSchema);

export default Restaurant;
