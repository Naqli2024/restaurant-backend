
const requirePermission = (module, action) => {
  return (req, res, next) => {
    try {
      // Administrator has full access within their restaurant.
      if (req.user?.roleCode === "ADMIN") {
        return next();
      }

      const permissions = req.user?.permissions || [];

      const hasPermission = permissions.some(
        (permission) =>
          permission.module === module &&
          permission.actions.includes(action)
      );

      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to perform this action.",
        });
      }

      next();
    } catch (error) {
      console.error("Permission middleware error:", error);

      return res.status(500).json({
        success: false,
        message: "Permission verification failed.",
      });
    }
  };
};

export default requirePermission;
