require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const { loginSchema, ZodError } = require("./lib/schemas/loginSchema");
const { z } = require("zod");
// JWT (MANUAL)
const jwt = {
  sign: (payload, secret, expiresInMs) => {
    const header = Buffer.from(
      JSON.stringify({ alg: "HS256", typ: "JWT" })
    ).toString("base64url");

    const body = {
      ...payload,
      exp: Date.now() + expiresInMs,
    };

    const payloadStr = Buffer.from(JSON.stringify(body)).toString("base64url");

    const signature = crypto
      .createHmac("sha256", secret)
      .update(header + "." + payloadStr)
      .digest("base64url");

    return `${header}.${payloadStr}.${signature}`;
  },

  verify: (token, secret) => {
    const [header, payload, signature] = token.split(".");
    const validSig = crypto
      .createHmac("sha256", secret)
      .update(header + "." + payload)
      .digest("base64url");

    if (signature !== validSig) {
      throw new Error("Invalid signature");
    }

    const data = JSON.parse(Buffer.from(payload, "base64url").toString());

    if (data.exp && data.exp < Date.now()) {
      throw new Error("Token expired");
    }

    return data;
  },
};

const users = new Map(); // email -> {id, email, passwordHash, refreshTokens[]}
const refreshTokenExpiry = new Map(); // token -> expiryTime

const app = express();
app.use(express.json());
app.use(cookieParser());

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

app.post(
  "/auth/register",
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    if (users.has(email)) {
      return res.status(409).json({ error: "User exists" });
    }

    const passwordHash = crypto
      .createHash("sha256")
      .update(password)
      .digest("hex");

    const userId = crypto.randomUUID();

    users.set(email, {
      id: userId,
      email,
      passwordHash,
      refreshTokens: [],
    });

    res.status(201).json({ message: "User created" });
  })
);

app.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    const user = users.get(email);
    const hashed = crypto.createHash("sha256").update(password).digest("hex");

    if (!user || user.passwordHash !== hashed) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const accessToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      15 * 60 * 1000
    );

    const refreshToken = crypto.randomBytes(40).toString("hex");

    refreshTokenExpiry.set(refreshToken, Date.now() + 7 * 24 * 60 * 60 * 1000);
    user.refreshTokens.push(refreshToken);

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: false, // true in production with HTTPS
      sameSite: "strict",
    });

    res.json({ accessToken, refreshToken });
  })
);

app.get(
  "/user/profile",
  asyncHandler(async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token" });
    }

    const accessToken = authHeader.slice(7);

    try {
      const payload = jwt.verify(accessToken, process.env.JWT_SECRET);
      const user = [...users.values()].find((u) => u.id === payload.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json({ email: user.email });
    } catch (err) {
      if (err.message === "Token expired") {
        return res.status(401).json({ error: "Token expired" });
      }
      if (err.message === "Invalid signature") {
        return res.status(401).json({ error: "Invalid token" });
      }
      throw err;
    }
  })
);

app.post(
  "/auth/refresh",
  asyncHandler(async (req, res) => {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken || !refreshTokenExpiry.has(refreshToken)) {
      return res.status(401).json({ error: "Invalid refresh token" });
    }

    const expiresAt = refreshTokenExpiry.get(refreshToken);
    if (expiresAt < Date.now()) {
      refreshTokenExpiry.delete(refreshToken);
      return res.status(401).json({ error: "Refresh token expired" });
    }

    const user = [...users.values()].find((u) =>
      u.refreshTokens.includes(refreshToken)
    );
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    // rotate refresh
    const newRefreshToken = crypto.randomBytes(40).toString("hex");
    refreshTokenExpiry.set(
      newRefreshToken,
      Date.now() + 7 * 24 * 60 * 60 * 1000
    );
    refreshTokenExpiry.delete(refreshToken);

    user.refreshTokens = user.refreshTokens.filter((t) => t !== refreshToken);
    user.refreshTokens.push(newRefreshToken);

    const newAccessToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      15 * 60 * 1000
    );

    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: false, // true in production with HTTPS
      sameSite: "strict",
    });

    res.json({ accessToken: newAccessToken });
  })
);

app.post(
  "/auth/forgot-password",
  asyncHandler(async (req, res) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);

    const user = users.get(email);

    if (!user) {
      return res.status(200).json({ message: "If user exists, email sent" });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    console.log(`RESET LINK: http://localhost:3000/reset?token=${resetToken}`);

    res.json({
      message: "Check console for reset link (dev only)",
    });
  })
);

app.use((err, req, res, next) => {
  if (err instanceof ZodError) {
    return res
      .status(400)
      .json({ error: "Validation failed", details: err.errors });
  }

  if (err.message === "Invalid signature") {
    return res.status(401).json({ error: "Token tampered" });
  }

  if (err.message === "Token expired") {
    return res.status(401).json({ error: "Token expired" });
  }

  console.error(`[ERROR] ${req.method} ${req.path}:`, err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Auth service on ${PORT}`);
});
