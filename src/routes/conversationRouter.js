// backend/src/routes/conversationRouter.js
import express from "express";
import trimRequest from "trim-request";

import { protect } from "../middlewares/authMiddleware.js";
import {
  createOpenConversation,
  getConversations,
  createGroup,
  addMemberToGroup,
  removeMemberFromGroup,
  leaveGroup,
  updateGroupMeta,
  getConversationById,
} from "../controllers/conversationController.js";

const conversationRouter = express.Router();

// Create New Direct Conversation Route
conversationRouter
  .route("/create-open-conversation")
  .post(trimRequest.all, protect, createOpenConversation);

// Get all conversations for the logged in user
conversationRouter
  .route("/get-conversations")
  .get(trimRequest.all, protect, getConversations);

// Get single conversation by id
conversationRouter
  .route("/:conversationId")
  .get(trimRequest.all, protect, getConversationById);

// Create Group Conversation
conversationRouter
  .route("/group")
  .post(trimRequest.all, protect, createGroup);

// Add member to group (admin)
conversationRouter
  .route("/:conversationId/add")
  .post(trimRequest.all, protect, addMemberToGroup);

// Remove member from group (admin)
conversationRouter
  .route("/:conversationId/remove")
  .post(trimRequest.all, protect, removeMemberFromGroup);

// Leave group (self)
conversationRouter
  .route("/:conversationId/leave")
  .post(trimRequest.all, protect, leaveGroup);

// Update group meta (admin)
conversationRouter
  .route("/:conversationId")
  .patch(trimRequest.all, protect, updateGroupMeta);

export default conversationRouter;
