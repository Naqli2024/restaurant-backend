import mongoose from "mongoose";

const employeeDocumentSchema = new mongoose.Schema(
  {
    documentType: {
      type: String,
      enum: [
        "AADHAAR",
        "PAN",
        "PASSPORT",
        "DRIVING_LICENSE",
        "VOTER_ID",
        "ADDRESS_PROOF",
        "BANK_PROOF",
        "EXPERIENCE_LETTER",
        "LAST_SALARY_SLIP",
        "QUALIFICATION_CERTIFICATE",
        "OTHER",
      ],
      required: true,
    },

    documentNumber: {
      type: String,
      trim: true,
      default: "",
    },

    fileUrl: {
      type: String,
      default: "",
    },

    originalFileName: {
      type: String,
      default: "",
    },

    mimeType: {
      type: String,
      default: "",
    },

    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true },
);

const employeeSchema = new mongoose.Schema(
  {
    // Restaurant reference
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },

    // Linked login account
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // STEP 1: BASIC DETAILS
    employeeCode: {
      type: String,
      trim: true,
      required: true,
      uppercase: true,
      default: "",
    },

    employeeName: {
      type: String,
      required: [true, "Employee name is required"],
      trim: true,
    },

    mobile: {
      type: String,
      required: [true, "Mobile number is required"],
      trim: true,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },

    photo: {
      type: String,
      default: "",
    },

    dateOfBirth: {
      type: Date,
      default: null,
    },

    gender: {
      type: String,
      enum: ["Male", "Female", "Other"],
      default: null,
    },

    designation: {
      type: String,
      trim: true,
      default: "",
    },

    department: {
      type: String,
      trim: true,
      default: "",
    },

    kitchenStationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "KitchenStation",
      default: null,
    },

    outletId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Outlet",
      default: null,
    },

    employmentType: {
      type: String,
      enum: ["Full-time", "Part-time", "Contract", "Temporary", "Intern"],
      default: "Full-time",
    },

    joiningDate: {
      type: Date,
      default: null,
    },

    currentAddress: {
      type: String,
      trim: true,
      default: "",
    },

    permanentAddress: {
      type: String,
      trim: true,
      default: "",
    },

    addressSameAsId: {
      type: Boolean,
      default: false,
    },

    // Identity information
    aadhaarNumber: {
      type: String,
      trim: true,
      default: "",
    },

    panNumber: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },

    passportNumber: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },

    drivingLicenseNumber: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },

    voterIdNumber: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },

    // STEP 2: EMERGENCY CONTACT
    emergencyContact: {
      name: {
        type: String,
        trim: true,
        default: "",
      },

      relationship: {
        type: String,
        trim: true,
        default: "",
      },

      mobile: {
        type: String,
        trim: true,
        default: "",
      },
    },

    // Nominee details
    nominee: {
      name: {
        type: String,
        trim: true,
        default: "",
      },

      relationship: {
        type: String,
        trim: true,
        default: "",
      },

      contact: {
        type: String,
        trim: true,
        default: "",
      },
    },

    // STEP 3: DOCUMENTS
    documents: {
      type: [employeeDocumentSchema],
      default: [],
    },

    // STEP 4: BANK DETAILS
    bankDetails: {
      accountHolderName: {
        type: String,
        trim: true,
        default: "",
      },

      accountNumber: {
        type: String,
        trim: true,
        default: "",
      },

      ifscCode: {
        type: String,
        trim: true,
        uppercase: true,
        default: "",
      },

      bankName: {
        type: String,
        trim: true,
        default: "",
      },

      branchName: {
        type: String,
        trim: true,
        default: "",
      },
    },

    // Salary details
    salaryDetails: {
      salaryType: {
        type: String,
        enum: ["Monthly", "Daily", "Hourly"],
        default: "Monthly",
      },

      basicSalary: {
        type: Number,
        min: 0,
        default: 0,
      },

      allowances: {
        type: Number,
        min: 0,
        default: 0,
      },

      deductions: {
        type: Number,
        min: 0,
        default: 0,
      },
    },

    // STEP 5: REVIEW
    isFresher: {
      type: Boolean,
      default: false,
    },

    onboardingStatus: {
      type: String,
      enum: ["Draft", "Pending", "Completed"],
      default: "Draft",
    },

    onboardingCompletedAt: {
      type: Date,
      default: null,
    },

    employmentStatus: {
      type: String,
      enum: ["Active", "On Leave", "Resigned", "Terminated"],
      default: "Active",
    },
  },
  {
    timestamps: true,
  },
);

// Employee code is unique within a restaurant when provided.
employeeSchema.index(
  { restaurantId: 1, employeeCode: 1 },
  {
    unique: true,
    partialFilterExpression: {
      employeeCode: { $type: "string", $gt: "" },
    },
  },
);

// Prevent duplicate employee mobile numbers within a restaurant.
employeeSchema.index({ restaurantId: 1, mobile: 1 }, { unique: true });

// Employee email is unique within a restaurant when provided.
employeeSchema.index(
  { restaurantId: 1, email: 1 },
  {
    unique: true,
    partialFilterExpression: {
      email: { $type: "string", $gt: "" },
    },
  },
);

const Employee = mongoose.model("Employee", employeeSchema);

export default Employee;
