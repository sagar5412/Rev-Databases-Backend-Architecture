import "dotenv/config.js";
import express from "express";
import { PrismaClient } from "@prisma/client";
import { generateShortId } from "./utils/generateShortId.js";

const app = express();
const prisma = new PrismaClient({});
app.use(express.json());

app.post("/api/shorten", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({ error: "Invalid URL" });
    }

    const normalizedUrl = parsed.toString();

    // Check if already exists
    const existing = await prisma.url.findFirst({
      where: { originalUrl: normalizedUrl },
    }).catch(() => null);

    if (existing) {
      return res.json({
        msg: "URL already exists",
        shortId: existing.shortId,
        shortUrl: `${process.env.BASE_URL}/${existing.shortId}`,
        originalUrl: existing.originalUrl,
      });
    }

    // Generate unique shortId
    let shortId;
    while (true) {
      shortId = generateShortId();
      const conflict = await prisma.url.findUnique({
        where: { shortId },
      });
      if (!conflict) break;
    }

    const doc = await prisma.url.create({
      data: {
        shortId,
        originalUrl: normalizedUrl,
      },
    });

    return res.status(201).json({
      shortId: doc.shortId,
      shortUrl: `${process.env.BASE_URL}/${doc.shortId}`,
      originalUrl: doc.originalUrl,
    });
  } catch (error) {
    console.error("Error in /api/shorten:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/:shortId", async (req, res) => {
  try {
    const { shortId } = req.params;
    const url = await prisma.url.findUnique({ where: { shortId } });

    if (!url) {
      return res.status(404).send("Short URL not found");
    }

    // Update clicks + timestamp
    await prisma.url.update({
      where: { shortId },
      data: {
        clicks: { increment: 1 },
        lastAccessedAt: new Date(),
      },
    });

    return res.redirect(url.originalUrl);
  } catch (error) {
    console.error("Redirect error:", error);
    return res.status(500).send("Internal server error");
  }
});


app.get("/api/stats/:shortId", async (req, res) => {
  try {
    const { shortId } = req.params;
    const url = await prisma.url.findUnique({ where: { shortId } });

    if (!url) return res.status(404).json({ error: "Not found" });

    return res.json(url);
  } catch (error) {
    console.error("Stats error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Global error handlers
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start server with proper error handling
const port = process.env.PORT || 3000;

async function startServer() {
  try {
    // Test database connection first
    await prisma.$connect();
    console.log('Database connected successfully');

    // Start the server
    const server = app.listen(port, () => {
      console.log(`URL shortener running on port ${port}`);
    });

    // Handle server errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`Error: Port ${port} is already in use`);
      } else {
        console.error('Server error:', error);
      }
      process.exit(1);
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
