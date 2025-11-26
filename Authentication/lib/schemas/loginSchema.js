const { z, ZodError } = require("zod");

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

module.exports = { loginSchema, ZodError };
