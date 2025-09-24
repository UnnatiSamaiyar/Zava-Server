import mongoose from "mongoose";
import jwt from "jsonwebtoken";

const SECRET_KEY = process.env.JWT_SECRET || "super-secret-key"; // env me rakho

// -------- Encryption Function ----------
function encryptMessage(message) {
  // payload ke andar sirf msg store karenge
  return jwt.sign({ msg: message }, SECRET_KEY, { algorithm: "HS256" });
}

// -------- Decryption Function (Safe) ----------
function decryptMessage(token) {
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    return decoded.msg || ""; // fallback to empty string
  } catch (err) {
    return ""; // agar error aaye to bhi empty string
  }
}

const messageSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.ObjectId, ref: "User" },

    message: {
      type: String,
      trim: true,
      set: (value) => (value ? encryptMessage(value) : ""), // DB me save hone se pehle encrypt
      get: (value) => (value ? decryptMessage(value) : ""), // DB se nikalte hi decrypt
    },

    conversation: { type: mongoose.Schema.ObjectId, ref: "Conversation" },

    files: [],
  },
  {
    timestamps: true,
    toJSON: { getters: true }, 
    toObject: { getters: true },
  }
);

const MessageModel = mongoose.model("Message", messageSchema);

export default MessageModel;