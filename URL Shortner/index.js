import "dotenv/config.js";
import express from "express";
import { connectDB } from "./db.js";
import { Url } from "./models/url.js";
import { generatedShortId } from "./utils/generateShortId.js";
import { asyncHandler } from "./utils/asyncHandler.js";
import { loadashGet } from "./utils/lodashGet.js";

const app = express();
app.use(express.json());
await connectDB();

app.post(
  "/api/shorten",
  asyncHandler(async (req, res) => {
    try {
      const url = loadashGet(req, "body.url", null);
      if (!url || typeof url != "string") {
        return res.status(400).json({
          error: "url is required",
        });
      }
      let parsed;
      try {
        parsed = new URL(url);
      } catch (error) {
        return res.status(400).json({
          error: "Invalid url",
        });
      }
      const normalizedUrl = parsed.toString();

      let existing = await Url.findOne({ originalURL: normalizedUrl });
      if (existing) {
        return res.json({
          shortId: existing.shortId,
          shortUrl: `${process.env.BASE_URL}/${existing.shortId}`,
          originalUrl: existing.originalURL,
        });
      }
      let shortId;

      while (true) {
        shortId = generatedShortId();
        const conflict = await Url.findOne({ shortId });
        if (!conflict) break;
      }
      const doc = await Url.create({
        shortId,
        originalURL: normalizedUrl,
      });

      return res.status(200).json({
        shortId: doc.shortId,
        shortUrl: `${process.env.BASE_URL}/${doc.shortId}`,
        originalUrl: doc.originalURL,
      });
    } catch (error) {
      console.error("Error in /api/shorten:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  })
);

app.get(
  "/:shortId",
  asyncHandler(async (req, res) => {
    try {
      const shortId = loadashGet(req, "params", null);
      const doc = await Url.findOne( shortId );
      if (!doc) {
        return res.status(404).json({
          error: "short url not found",
        });
      }
      doc.clicks += 1;
      doc.lastAccessedAt = new Date();
      await doc.save();

      return res.redirect(doc.originalURL);
    } catch (error) {
      console.error("Error in redirect route:", error);
      return res.status(500).send("Internal server error");
    }
  })
);


app.use((req, res, next) => {
  res.status(404).json({
    msg: "Route not found",
  });
});

app.use((err, req, res, next) => {
  res.status(500).json({ msg: "Something went wrong" });
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`URL shortener running on port ${port}`);
});
