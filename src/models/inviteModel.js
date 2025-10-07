import mongoose from "mongoose";

const inviteSchema = mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    conversation: { type: mongoose.Schema.ObjectId, ref: "Conversation", required: true },
    createdBy: { type: mongoose.Schema.ObjectId, ref: "User", required: true },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }, // default 7 days
  },
  { timestamps: true }
);

const InviteModel = mongoose.model("Invite", inviteSchema);

export default InviteModel;
