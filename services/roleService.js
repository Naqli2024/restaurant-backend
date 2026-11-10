import Role from "../models/Role.js";

export const DEFAULT_ROLES = [
  {
    name: "Administrator",
    code: "ADMIN",
    description: "Manage all restaurant operations.",
    permissions: [],
  },
  {
    name: "Cashier",
    code: "CASHIER",
    description: "Manage billing and payments.",
    permissions: [
      {
        module: "billing",
        actions: ["create", "read", "update"],
      },
      {
        module: "payments",
        actions: ["create", "read"],
      },
      {
        module: "orders",
        actions: ["read"],
      },
    ],
  },
  {
    name: "Captain / Waiter",
    code: "CAPTAIN",
    description: "Manage tables and customer orders.",
    permissions: [
      {
        module: "tables",
        actions: ["read", "update"],
      },
      {
        module: "orders",
        actions: ["create", "read", "update"],
      },
      {
        module: "menu",
        actions: ["read"],
      },
    ],
  },
  {
    name: "Kitchen Staff",
    code: "KITCHEN",
    description: "Manage kitchen orders.",
    permissions: [
      {
        module: "kot",
        actions: ["read", "update"],
      },
      {
        module: "orders",
        actions: ["read"],
      },
    ],
  },
  {
    name: "Back Office",
    code: "BACKOFFICE",
    description: "Manage inventory, purchases, and expenses.",
    permissions: [
      {
        module: "inventory",
        actions: ["create", "read", "update"],
      },
      {
        module: "purchases",
        actions: ["create", "read", "update"],
      },
      {
        module: "expenses",
        actions: ["create", "read", "update"],
      },
      {
        module: "reports",
        actions: ["read", "export"],
      },
    ],
  },
];

export const initializeDefaultRoles = async (
  restaurantId,
  session = null
) => {
  const options = session ? { session } : {};

  for (const role of DEFAULT_ROLES) {
    await Role.findOneAndUpdate(
      { restaurantId, code: role.code },
      {
        $setOnInsert: {
          restaurantId,
          ...role,
          isSystemRole: true,
          isActive: true,
        },
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
        ...options,
      }
    );
  }

  const query = Role.find({ restaurantId }).sort({ code: 1 });

  if (session) {
    query.session(session);
  }

  return query;
};