
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

import Employee from "../models/Employee.js";
import User from "../models/User.js";
import Role from "../models/Role.js";
import KitchenStation from "../models/KitchenStation.js";

// Fields accepted by the employee form.
const ALLOWED_EMPLOYEE_FIELDS = [
  "employeeCode",
  "employeeName",
  "mobile",
  "email",
  "photo",
  "dateOfBirth",
  "gender",
  "designation",
  "department",
  "outletId",
  "kitchenStationId",
  "employmentType",
  "joiningDate",
  "currentAddress",
  "permanentAddress",
  "addressSameAsId",
  "aadhaarNumber",
  "panNumber",
  "passportNumber",
  "drivingLicenseNumber",
  "voterIdNumber",
  "emergencyContact",
  "nominee",
  "documents",
  "bankDetails",
  "salaryDetails",
  "isFresher",
  "onboardingStatus",
  "employmentStatus",
];

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const handleError = (res, error, operation) => {
  console.error(`${operation} error:`, error);

  if (error.code === 11000) {
    return res.status(409).json({
      success: false,
      message: "A record with this information already exists.",
      field: Object.keys(error.keyPattern || {})[0] || null,
    });
  }

  const statusCode =
    error.statusCode ||
    (error.name === "ValidationError" ? 400 : 500);

  return res.status(statusCode).json({
    success: false,
    message:
      statusCode === 500
        ? "Something went wrong. Please try again."
        : error.message,
  });
};

// Copy only allowed Employee fields.
const getEmployeeData = (data = {}) => {
  const employeeData = {};

  for (const field of ALLOWED_EMPLOYEE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      employeeData[field] = data[field];
    }
  }

  return employeeData;
};

// Generate employee code automatically within a restaurant.
const generateEmployeeCode = async (restaurantId, session) => {
  const lastEmployee = await Employee.findOne({ restaurantId })
    .sort({ createdAt: -1 })
    .select("employeeCode")
    .session(session);

  const lastNumber = lastEmployee
    ? parseInt(lastEmployee.employeeCode, 10) || 0
    : 0;

  return String(lastNumber + 1).padStart(3, "0");
};

// Validate employee onboarding information.
const validateEmployeeOnboarding = (employee) => {
  const missingFields = [];

  if (!employee.employeeName?.trim()) {
    missingFields.push("Employee name");
  }

  if (!employee.mobile?.trim()) {
    missingFields.push("Mobile number");
  }

  if (!employee.designation?.trim()) {
    missingFields.push("Designation");
  }

  if (!employee.department?.trim()) {
    missingFields.push("Department");
  }

  if (!employee.joiningDate) {
    missingFields.push("Joining date");
  }

  if (!employee.emergencyContact?.name?.trim()) {
    missingFields.push("Emergency contact name");
  }

  if (!employee.emergencyContact?.mobile?.trim()) {
    missingFields.push("Emergency contact mobile");
  }

  if (!employee.bankDetails?.accountHolderName?.trim()) {
    missingFields.push("Bank account holder name");
  }

  if (!employee.bankDetails?.accountNumber?.trim()) {
    missingFields.push("Bank account number");
  }

  if (!employee.bankDetails?.ifscCode?.trim()) {
    missingFields.push("Bank IFSC code");
  }

  if (!employee.salaryDetails?.salaryType) {
    missingFields.push("Salary type");
  }

  if (
    employee.salaryDetails?.basicSalary === undefined ||
    employee.salaryDetails?.basicSalary === null
  ) {
    missingFields.push("Basic salary");
  }

  return missingFields;
};

// Validate that the role belongs to this restaurant.
const getValidRole = async (roleId, restaurantId, session) => {
  if (!mongoose.isValidObjectId(roleId)) {
    throw createError("Please select a valid employee role.");
  }

  const role = await Role.findOne({
    _id: roleId,
    restaurantId,
    isActive: true,
  }).session(session);

  if (!role) {
    throw createError("Selected role is invalid or inactive.");
  }

  return role;
};

// Validate a kitchen station within this restaurant.
const getValidKitchenStation = async (
  kitchenStationId,
  restaurantId,
  session
) => {
  if (!mongoose.isValidObjectId(kitchenStationId)) {
    throw createError(
      "A valid kitchen station is required for a kitchen employee."
    );
  }

  const station = await KitchenStation.findOne({
    _id: kitchenStationId,
    restaurantId,
    isActive: true,
  }).session(session);

  if (!station) {
    throw createError("Selected kitchen station is invalid or inactive.");
  }

  return station;
};

// Validate onboarding status and completion details.
const applyOnboardingStatus = (employee) => {
  if (employee.onboardingStatus === "Completed") {
    const missingFields = validateEmployeeOnboarding(employee);

    if (missingFields.length > 0) {
      throw createError(
        `Complete these fields before onboarding: ${missingFields.join(", ")}`
      );
    }

    if (!employee.onboardingCompletedAt) {
      employee.onboardingCompletedAt = new Date();
    }
  } else {
    employee.onboardingCompletedAt = null;
  }
};

// Create a login account linked to an Employee.
const createEmployeeUser = async ({
  employee,
  account,
  restaurantId,
  session,
}) => {
  if (!account?.username?.trim()) {
    throw createError("Username is required to create a login account.");
  }

  if (!account?.password || account.password.length < 8) {
    throw createError("Password must contain at least 8 characters.");
  }

  const username = account.username.trim().toLowerCase();

  // Usernames are globally unique.
  const existingUser = await User.findOne({ username }).session(session);

  if (existingUser) {
    throw createError("This username is already taken.");
  }

  const role = await getValidRole(
    account.roleId,
    restaurantId,
    session
  );

  // Kitchen employees must have an active station assignment.
  if (role.code === "KITCHEN") {
    await getValidKitchenStation(
      employee.kitchenStationId,
      restaurantId,
      session
    );
  } else {
    employee.kitchenStationId = null;
  }

  const hashedPassword = await bcrypt.hash(account.password, 12);

  const [user] = await User.create(
    [
      {
        restaurantId,
        employeeId: employee._id,
        username,
        email: employee.email || null,
        password: hashedPassword,
        roleId: role._id,
        isActive: true,
      },
    ],
    { session }
  );

  employee.userId = user._id;
  await employee.save({ session });

  return user;
};

// POST /api/employees
export const addEmployee = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const {
      employee,
      createLoginAccount = false,
      account = {},
    } = req.body;

    if (!employee || typeof employee !== "object" || Array.isArray(employee)) {
      return res.status(400).json({
        success: false,
        message: "Employee details are required.",
      });
    }

    let result;

    await session.withTransaction(async () => {
      const restaurantId = req.user.restaurantId;
      const cleanEmployeeData = getEmployeeData(employee);

      // The employee code is generated by the backend.
      delete cleanEmployeeData.employeeCode;

      const employeeCode = await generateEmployeeCode(
        restaurantId,
        session
      );

      const newEmployee = new Employee({
        ...cleanEmployeeData,
        employeeCode,
        restaurantId,
      });

      if (createLoginAccount) {
        // Role and station are validated before creating the login account.
        // createEmployeeUser also links the User and Employee documents.
        await newEmployee.save({ session });

        const user = await createEmployeeUser({
          employee: newEmployee,
          account,
          restaurantId,
          session,
        });

        applyOnboardingStatus(newEmployee);
        await newEmployee.save({ session });

        result = {
          employee: newEmployee,
          user: {
            id: user._id,
            username: user.username,
            roleId: user.roleId,
            isActive: user.isActive,
          },
        };
      } else {
        // An employee without a login account has no assigned application role.
        newEmployee.kitchenStationId = null;

        applyOnboardingStatus(newEmployee);
        await newEmployee.save({ session });

        result = {
          employee: newEmployee,
          user: null,
        };
      }
    });

    return res.status(201).json({
      success: true,
      message: "Employee created successfully.",
      data: result,
    });
  } catch (error) {
    return handleError(res, error, "Add employee");
  } finally {
    await session.endSession();
  }
};

// PUT /api/employees/:id
export const editEmployee = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const employeeId = req.params.id;
    const restaurantId = req.user.restaurantId;
    const employeeData = req.body.employee || req.body;
    const cleanEmployeeData = getEmployeeData(employeeData);

    if (!mongoose.isValidObjectId(employeeId)) {
      throw createError("Invalid employee ID.");
    }

    let updatedEmployee;

    await session.withTransaction(async () => {
      const employee = await Employee.findOne({
        _id: employeeId,
        restaurantId,
      }).session(session);

      if (!employee) {
        throw createError("Employee not found.", 404);
      }

      // Role changes are sent separately from employee profile fields.
      const requestedRoleId =
        req.body.account?.roleId || req.body.roleId;

      let linkedUser = null;
      let effectiveRole = null;

      if (employee.userId) {
        linkedUser = await User.findOne({
          _id: employee.userId,
          restaurantId,
        }).session(session);

        if (!linkedUser) {
          throw createError("Linked employee login account was not found.", 404);
        }

        effectiveRole = requestedRoleId
          ? await getValidRole(requestedRoleId, restaurantId, session)
          : await Role.findOne({
              _id: linkedUser.roleId,
              restaurantId,
              isActive: true,
            }).session(session);

        if (!effectiveRole) {
          throw createError("Employee's current role is invalid or inactive.");
        }

        if (requestedRoleId) {
          linkedUser.roleId = effectiveRole._id;
        }
      }

      employee.set(cleanEmployeeData);

      if (linkedUser && effectiveRole.code === "KITCHEN") {
        await getValidKitchenStation(
          employee.kitchenStationId,
          restaurantId,
          session
        );
      } else {
        // Non-kitchen employees must not retain a kitchen station.
        employee.kitchenStationId = null;
      }

      applyOnboardingStatus(employee);

      if (linkedUser) {
        await linkedUser.save({ session });
      }

      await employee.save({ session });

      updatedEmployee = employee;
    });

    return res.status(200).json({
      success: true,
      message: "Employee updated successfully.",
      data: updatedEmployee,
    });
  } catch (error) {
    return handleError(res, error, "Update employee");
  } finally {
    await session.endSession();
  }
};

// GET /api/employees
export const listEmployees = async (req, res) => {
  try {
    const currentPage = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.limit) || 10));
    const search = (req.query.search || "").trim();
    const status = req.query.status || "";

    const filter = {
      restaurantId: req.user.restaurantId,
    };

    if (search) {
      filter.$or = [
        { employeeName: { $regex: search, $options: "i" } },
        { employeeCode: { $regex: search, $options: "i" } },
        { mobile: { $regex: search, $options: "i" } },
      ];
    }

    if (status) {
      filter.employmentStatus = status;
    }

    const [employees, total] = await Promise.all([
      Employee.find(filter)
        .select(
          "-aadhaarNumber -panNumber -passportNumber -drivingLicenseNumber -voterIdNumber -bankDetails.accountNumber -documents.documentNumber -documents.fileUrl"
        )
        .populate("userId", "username isActive")
        .populate("kitchenStationId", "name code")
        .sort({ createdAt: -1 })
        .skip((currentPage - 1) * pageSize)
        .limit(pageSize),

      Employee.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      count: employees.length,
      pagination: {
        total,
        page: currentPage,
        limit: pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
      data: employees,
    });
  } catch (error) {
    return handleError(res, error, "List employees");
  }
};

// GET /api/employees/:id
export const getEmployee = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      throw createError("Invalid employee ID.");
    }

    const employee = await Employee.findOne({
      _id: req.params.id,
      restaurantId: req.user.restaurantId,
    })
      .populate("userId", "username isActive roleId")
      .populate("kitchenStationId", "name code");

    if (!employee) {
      throw createError("Employee not found.", 404);
    }

    return res.status(200).json({
      success: true,
      data: employee,
    });
  } catch (error) {
    return handleError(res, error, "Get employee");
  }
};

// PATCH /api/employees/:id/onboarding
export const changeOnboardingStatus = async (req, res) => {
  try {
    const { onboardingStatus } = req.body;

    if (!["Draft", "Pending", "Completed"].includes(onboardingStatus)) {
      throw createError("Invalid onboarding status.");
    }

    const employee = await Employee.findOne({
      _id: req.params.id,
      restaurantId: req.user.restaurantId,
    });

    if (!employee) {
      throw createError("Employee not found.", 404);
    }

    employee.onboardingStatus = onboardingStatus;
    applyOnboardingStatus(employee);

    await employee.save();

    return res.status(200).json({
      success: true,
      message: "Onboarding status updated successfully.",
      data: employee,
    });
  } catch (error) {
    return handleError(res, error, "Update onboarding status");
  }
};

// PATCH /api/employees/:id/status
export const changeEmploymentStatus = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { status } = req.body;

    const allowedStatuses = [
      "Active",
      "On Leave",
      "Resigned",
      "Terminated",
    ];

    if (!allowedStatuses.includes(status)) {
      throw createError("Invalid employment status.");
    }

    let employee;

    await session.withTransaction(async () => {
      employee = await Employee.findOne({
        _id: req.params.id,
        restaurantId: req.user.restaurantId,
      }).session(session);

      if (!employee) {
        throw createError("Employee not found.", 404);
      }

      employee.employmentStatus = status;
      await employee.save({ session });

      // Disable login for employees who resign or are terminated.
      if (
        ["Resigned", "Terminated"].includes(status) &&
        employee.userId
      ) {
        await User.updateOne(
          {
            _id: employee.userId,
            restaurantId: req.user.restaurantId,
          },
          {
            $set: { isActive: false },
          },
          { session }
        );
      }

      // Re-enable login if an employee returns to Active status.
      if (status === "Active" && employee.userId) {
        await User.updateOne(
          {
            _id: employee.userId,
            restaurantId: req.user.restaurantId,
          },
          {
            $set: { isActive: true },
          },
          { session }
        );
      }
    });

    return res.status(200).json({
      success: true,
      message: "Employment status updated successfully.",
      data: employee,
    });
  } catch (error) {
    return handleError(res, error, "Update employment status");
  } finally {
    await session.endSession();
  }
};
