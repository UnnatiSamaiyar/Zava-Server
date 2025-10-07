// backend/src/routes/uploadRouter.js
import express from "express";
import multer from "multer";
import { uploadFiles } from "../utils/cloudinaryUpload.js"; // adjust path

const uploadRouter = express.Router();

// use memory storage so files are available in req.files as buffers
const storage = multer.memoryStorage();
const upload = multer({ storage });

// POST /api/upload
uploadRouter.post("/", upload.array("files"), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ status: "fail", message: "No files uploaded" });
    }

    const result = await uploadFiles("zava", req.files, "groupPictures");
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default uploadRouter;
