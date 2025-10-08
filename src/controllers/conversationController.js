// // backend/src/controllers/conversationController.js
// import createHttpError from "http-errors";

// import { UserModel } from "../models/index.js";
// import {
//   createConversation,
//   findConversation,
//   getUserConversations,
// } from "../services/conversationService.js";

// import ConversationModel from "../models/conversationModel.js";
// import MessageModel from "../models/messageModel.js";

// /**
//  * Create / Open Direct Conversation
//  */
// export const createOpenConversation = async (req, res, next) => {
//   try {
//     const sender = req.user;

//     const sender_id = sender._id;
//     const { receiver_id } = req.body;

//     // check for required fields
//     if (!receiver_id) {
//       throw createHttpError.BadRequest("Something went wrong");
//     }

//     // check if receiver exists
//     const receiver = await UserModel.findOne({
//       _id: receiver_id,
//       verified: true,
//     });

//     // check if receiver exists
//     if (!receiver) {
//       throw createHttpError.NotFound("Verified Receiver does not exist");
//     }

//     // check for existing conversation
//     const existing_conversation = await findConversation(
//       sender_id,
//       receiver_id
//     );

//     const isValidFriendShip = !(
//       !sender.friends.includes(receiver_id) ||
//       !receiver.friends.includes(sender_id)
//     );

//     if (existing_conversation) {
//       res.status(200).json({
//         status: "success",
//         conversation: existing_conversation,
//         isValidFriendShip,
//       });
//     } else {
//       // check if users are friends
//       if (
//         !sender.friends.includes(receiver_id) ||
//         !receiver.friends.includes(sender_id)
//       ) {
//         throw createHttpError.Forbidden("You are not friends with this user");
//       }

//       // creating a new conversation
//       let convoData;

//       if (sender_id.toString() === receiver_id.toString()) {
//         convoData = {
//           name: `${receiver.firstName} ${receiver.lastName}`,
//           isGroup: false,
//           users: [receiver_id],
//         };
//       } else {
//         convoData = {
//           name: `${receiver.firstName} ${receiver.lastName}`,
//           isGroup: false,
//           users: [sender_id, receiver_id],
//         };
//       }

//       const new_conversation = await createConversation(convoData);

//       res.status(200).json({
//         status: "success",
//         conversation: new_conversation,
//         isValidFriendShip,
//       });
//     }
//   } catch (error) {
//     next(error);
//   }
// };

// /**
//  * Get all user conversations
//  */
// export const getConversations = async (req, res, next) => {
//   try {
//     const user_id = req.user._id;

//     const conversations = await getUserConversations(user_id);

//     res.status(200).json({ status: "success", conversations: conversations });
//   } catch (error) {
//     next(error);
//   }
// };

// /**
//  * Get single conversation by id (with messages pagination)
//  */
// export const getConversationById = async (req, res, next) => {
//   try {
//     const { conversationId } = req.params;
//     const conversation = await ConversationModel.findById(conversationId)
//       .populate("users", "firstName lastName avatar email")
//       .populate({
//         path: "latestMessage",
//         populate: { path: "sender", select: "firstName lastName avatar" },
//       });

//     if (!conversation) {
//       throw createHttpError.NotFound("Conversation not found");
//     }

//     // Check membership
//     if (!conversation.users.some((u) => u._id.toString() === req.user._id.toString())) {
//       throw createHttpError.Forbidden("You are not a member of this conversation");
//     }

//     res.status(200).json({ status: "success", conversation });
//   } catch (error) {
//     next(error);
//   }
// };

// /**
//  * Join user's conversations into socket rooms
//  * (used by socket initialization to auto-join all conversation rooms for a user)
//  */
// export const joinConvo = async (socket, user_id) => {
//   try {
//     const conversations = await getUserConversations(user_id);

//     conversations.map((convo) => {
//       socket.join(convo._id.toString());
//     });
//   } catch (error) {
//     socket.errorHandler("Join convo error");
//   }
// };

// /**
//  * Create a Group Conversation
//  * Body: { name: string, userIds: [string], picture?: string }
//  */
// export const createGroup = async (req, res, next) => {
//   try {
//     const { name, userIds = [], picture } = req.body;

//     const incoming = Array.isArray(userIds)
//       ? userIds
//       : userIds
//       ? String(userIds).split(",").map((s) => s.trim())
//       : [];

//     const members = Array.from(
//       new Set([...(incoming || []), req.user._id.toString()])
//     );

//     if (members.length < 2) {
//       return res
//         .status(400)
//         .json({ status: "fail", message: "Group must have at least 2 members (including you)" });
//     }

//     const group = await ConversationModel.create({
//       name: name || "Group",
//       picture: picture || "",
//       isGroup: true,
//       users: members,
//       admin: req.user._id,
//     });

//     await group.populate({ path: "users", select: "firstName lastName avatar email" });

//     // Emit real-time notification to each member that a group was created (personal room)
//     try {
//       const { getIO } = await import("../../socket.js"); // relative to controllers folder
//       const io = getIO();
//       if (io) {
//         members.forEach((uid) => {
//           io.to(uid).emit("group_created", { group });
//         });
//       }
//     } catch (err) {
//       // safe ignore if socket isn't available
//     }

//     return res.status(201).json({ status: "success", group });
//   } catch (err) {
//     next(err);
//   }
// };

// /**
//  * Add member to group (admin only)
//  * Body: { userId: string }
//  */
// export const addMemberToGroup = async (req, res, next) => {
//   try {
//     const { conversationId } = req.params;
//     const { userId } = req.body;

//     if (!userId) throw createHttpError.BadRequest("userId is required");

//     const conv = await ConversationModel.findById(conversationId);
//     if (!conv) throw createHttpError.NotFound("Group not found");
//     if (!conv.isGroup) throw createHttpError.BadRequest("Not a group");

//     // only admin can add
//     if (conv.admin.toString() !== req.user._id.toString()) {
//       throw createHttpError.Forbidden("Only admin can add members");
//     }

//     if (!conv.users.includes(userId)) {
//       conv.users.push(userId);
//       await conv.save();
//     }

//     await conv.populate({ path: "users", select: "firstName lastName avatar email" });

//     // notify existing members and the added member
//     try {
//       const { getIO } = await import("../../socket.js");
//       const io = getIO();
//       if (io) {
//         // notify the added user
//         io.to(userId).emit("member_added", { conversation: conv, addedBy: req.user._id });

//         // notify other members about the new member
//         conv.users.forEach((uid) => {
//           if (uid.toString() !== userId.toString()) {
//             io.to(uid.toString()).emit("member_added_broadcast", { conversation: conv, newMember: userId });
//           }
//         });
//       }
//     } catch (err) {}

//     res.status(200).json({ status: "success", conversation: conv });
//   } catch (err) {
//     next(err);
//   }
// };

// /**
//  * Remove member from group (admin only)
//  * Body: { userId: string }
//  */
// export const removeMemberFromGroup = async (req, res, next) => {
//   try {
//     const { conversationId } = req.params;
//     const { userId } = req.body;

//     if (!userId) throw createHttpError.BadRequest("userId is required");

//     const conv = await ConversationModel.findById(conversationId);
//     if (!conv) throw createHttpError.NotFound("Group not found");
//     if (!conv.isGroup) throw createHttpError.BadRequest("Not a group");

//     // only admin can remove
//     if (conv.admin.toString() !== req.user._id.toString()) {
//       throw createHttpError.Forbidden("Only admin can remove members");
//     }

//     conv.users = conv.users.filter((u) => u.toString() !== userId.toString());

//     // if admin removed themselves (shouldn't happen because admin is caller), reassign admin
//     if (conv.admin.toString() === userId.toString()) {
//       conv.admin = conv.users.length ? conv.users[0] : undefined;
//     }

//     await conv.save();
//     await conv.populate({ path: "users", select: "firstName lastName avatar email" });

//     // notify removed user and remaining members
//     try {
//       const { getIO } = await import("../../socket.js");
//       const io = getIO();
//       if (io) {
//         io.to(userId).emit("member_removed", { conversationId, removedBy: req.user._id });
//         conv.users.forEach((uid) => {
//           io.to(uid.toString()).emit("member_removed_broadcast", { conversationId, removedUser: userId });
//         });
//       }
//     } catch (err) {}

//     res.status(200).json({ status: "success", conversation: conv });
//   } catch (err) {
//     next(err);
//   }
// };

// /**
//  * Leave group (self)
//  */
// export const leaveGroup = async (req, res, next) => {
//   try {
//     const { conversationId } = req.params;
//     const conv = await ConversationModel.findById(conversationId);
//     if (!conv) throw createHttpError.NotFound("Group not found");
//     if (!conv.isGroup) throw createHttpError.BadRequest("Not a group");

//     conv.users = conv.users.filter((u) => u.toString() !== req.user._id.toString());

//     if (conv.admin.toString() === req.user._id.toString()) {
//       conv.admin = conv.users.length ? conv.users[0] : undefined;
//     }

//     if (conv.users.length === 0) {
//       await ConversationModel.findByIdAndDelete(conversationId);
//       // notify (no members left so nothing to notify)
//       return res.status(200).json({ status: "success", message: "Group deleted as no members remained" });
//     }

//     await conv.save();

//     // notify remaining members that someone left
//     try {
//       const { getIO } = await import("../../socket.js");
//       const io = getIO();
//       if (io) {
//         conv.users.forEach((uid) => {
//           io.to(uid.toString()).emit("member_left", { conversationId, userId: req.user._id });
//         });
//       }
//     } catch (err) {}

//     res.status(200).json({ status: "success", conversation: conv });
//   } catch (err) {
//     next(err);
//   }
// };

// /**
//  * Update group meta (name / picture) - admin only
//  * Body: { name?: string, picture?: string }
//  */
// export const updateGroupMeta = async (req, res, next) => {
//   try {
//     const { conversationId } = req.params;
//     const { name, picture } = req.body;

//     const conv = await ConversationModel.findById(conversationId);
//     if (!conv) throw createHttpError.NotFound("Group not found");
//     if (!conv.isGroup) throw createHttpError.BadRequest("Not a group");

//     // admin only
//     if (conv.admin.toString() !== req.user._id.toString()) {
//       throw createHttpError.Forbidden("Only admin can update the group");
//     }

//     if (name !== undefined) conv.name = name;
//     if (picture !== undefined) conv.picture = picture;

//     await conv.save();
//     await conv.populate({ path: "users", select: "firstName lastName avatar email" });

//     // notify members
//     try {
//       const { getIO } = await import("../../socket.js");
//       const io = getIO();
//       if (io) {
//         conv.users.forEach((uid) => {
//           io.to(uid.toString()).emit("group_updated", { conversation: conv });
//         });
//       }
//     } catch (err) {}

//     res.status(200).json({ status: "success", conversation: conv });
//   } catch (err) {
//     next(err);
//   }
// };


// backend/src/controllers/conversationController.js
import createHttpError from "http-errors";

import { UserModel } from "../models/index.js";
import {
  createConversation,
  findConversation,
  getUserConversations,
} from "../services/conversationService.js";

import ConversationModel from "../models/conversationModel.js";

import crypto from "crypto";

import InviteModel from "../models/inviteModel.js";
import { nanoid } from "nanoid";

/**
 * Create / Open Direct Conversation
 */
export const createOpenConversation = async (req, res, next) => {
  try {
    const sender = req.user;
    const sender_id = sender._id;
    const { receiver_id } = req.body;

    if (!receiver_id) throw createHttpError.BadRequest("Something went wrong");

    const receiver = await UserModel.findOne({
      _id: receiver_id,
      verified: true,
    });

    if (!receiver) throw createHttpError.NotFound("Verified Receiver does not exist");

    const existing_conversation = await findConversation(sender_id, receiver_id);

    const isValidFriendShip = !(
      !sender.friends.includes(receiver_id) ||
      !receiver.friends.includes(sender_id)
    );

    if (existing_conversation) {
      res.status(200).json({
        status: "success",
        conversation: existing_conversation,
        isValidFriendShip,
      });
    } else {
      if (
        !sender.friends.includes(receiver_id) ||
        !receiver.friends.includes(sender_id)
      ) {
        throw createHttpError.Forbidden("You are not friends with this user");
      }

      const convoData =
        sender_id.toString() === receiver_id.toString()
          ? {
              name: `${receiver.firstName} ${receiver.lastName}`,
              isGroup: false,
              users: [receiver_id],
            }
          : {
              name: `${receiver.firstName} ${receiver.lastName}`,
              isGroup: false,
              users: [sender_id, receiver_id],
            };

      const new_conversation = await createConversation(convoData);

      res.status(200).json({
        status: "success",
        conversation: new_conversation,
        isValidFriendShip,
      });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Get all user conversations
 */
export const getConversations = async (req, res, next) => {
  try {
    const user_id = req.user._id;
    const conversations = await getUserConversations(user_id);
    res.status(200).json({ status: "success", conversations });
  } catch (error) {
    next(error);
  }
};

/**
 * Get single conversation by id
 */
export const getConversationById = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const conversation = await ConversationModel.findById(conversationId)
      .populate("users", "firstName lastName avatar email")
      .populate("admin", "firstName lastName avatar email")
      .populate({
        path: "latestMessage",
        populate: { path: "sender", select: "firstName lastName avatar" },
      });

    if (!conversation) throw createHttpError.NotFound("Conversation not found");

    if (!conversation.users.some((u) => u._id.toString() === req.user._id.toString())) {
      throw createHttpError.Forbidden("You are not a member of this conversation");
    }

    res.status(200).json({ status: "success", conversation });
  } catch (error) {
    next(error);
  }
};

/**
 * Join user's conversations into socket rooms
 */
export const joinConvo = async (socket, user_id) => {
  try {
    const conversations = await getUserConversations(user_id);
    conversations.map((convo) => socket.join(convo._id.toString()));
  } catch (error) {
    socket.errorHandler("Join convo error");
  }
};

/**
 * Create a Group Conversation
 */
export const createGroup = async (req, res, next) => {
  try {
    const { name, userIds = [], picture } = req.body;

    const incoming = Array.isArray(userIds)
      ? userIds
      : userIds
      ? String(userIds).split(",").map((s) => s.trim())
      : [];

    const members = Array.from(new Set([...(incoming || []), req.user._id.toString()]));

    if (members.length < 2) {
      return res.status(400).json({
        status: "fail",
        message: "Group must have at least 2 members (including you)",
      });
    }

    const group = await ConversationModel.create({
      name: name || "Group",
      picture: picture || "",
      isGroup: true,
      users: members,
      admin: req.user._id,
    });

    await group.populate([
      { path: "users", select: "firstName lastName avatar email" },
      { path: "admin", select: "firstName lastName avatar email" },
    ]);

    try {
      const { getIO } = await import("../../socket.js");
      const io = getIO();
      if (io) {
        members.forEach((uid) => {
          io.to(uid).emit("group_created", { group });
        });
      }
    } catch (err) {}

    return res.status(201).json({ status: "success", group });
  } catch (err) {
    next(err);
  }
};

/**
 * Add member to group (admin only)
 */
export const addMemberToGroup = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const { userId } = req.body;

    if (!userId) throw createHttpError.BadRequest("userId is required");

    const conv = await ConversationModel.findById(conversationId);
    if (!conv) throw createHttpError.NotFound("Group not found");
    if (!conv.isGroup) throw createHttpError.BadRequest("Not a group");

    if (conv.admin.toString() !== req.user._id.toString()) {
      throw createHttpError.Forbidden("Only admin can add members");
    }

    if (!conv.users.includes(userId)) {
      conv.users.push(userId);
      await conv.save();
    }

    await conv.populate([
      { path: "users", select: "firstName lastName avatar email" },
      { path: "admin", select: "firstName lastName avatar email" },
    ]);

    try {
      const { getIO } = await import("../../socket.js");
      const io = getIO();
      if (io) {
        io.to(userId).emit("member_added", { conversation: conv, addedBy: req.user._id });
        conv.users.forEach((uid) => {
          if (uid.toString() !== userId.toString()) {
            io.to(uid.toString()).emit("member_added_broadcast", {
              conversation: conv,
              newMember: userId,
            });
          }
        });
      }
    } catch (err) {}

    res.status(200).json({ status: "success", conversation: conv });
  } catch (err) {
    next(err);
  }
};

/**
 * Remove member from group (admin only)
 */
export const removeMemberFromGroup = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const { userId } = req.body;

    if (!userId) throw createHttpError.BadRequest("userId is required");

    const conv = await ConversationModel.findById(conversationId);
    if (!conv) throw createHttpError.NotFound("Group not found");
    if (!conv.isGroup) throw createHttpError.BadRequest("Not a group");

    if (conv.admin.toString() !== req.user._id.toString()) {
      throw createHttpError.Forbidden("Only admin can remove members");
    }

    conv.users = conv.users.filter((u) => u.toString() !== userId.toString());

    if (conv.admin.toString() === userId.toString()) {
      conv.admin = conv.users.length ? conv.users[0] : undefined;
    }

    await conv.save();
    await conv.populate([
      { path: "users", select: "firstName lastName avatar email" },
      { path: "admin", select: "firstName lastName avatar email" },
    ]);

    try {
      const { getIO } = await import("../../socket.js");
      const io = getIO();
      if (io) {
        io.to(userId).emit("member_removed", { conversationId, removedBy: req.user._id });
        conv.users.forEach((uid) => {
          io.to(uid.toString()).emit("member_removed_broadcast", {
            conversationId,
            removedUser: userId,
          });
        });
      }
    } catch (err) {}

    res.status(200).json({ status: "success", conversation: conv });
  } catch (err) {
    next(err);
  }
};

/**
 * Leave group (self)
 */
export const leaveGroup = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const conv = await ConversationModel.findById(conversationId);
    if (!conv) throw createHttpError.NotFound("Group not found");
    if (!conv.isGroup) throw createHttpError.BadRequest("Not a group");

    conv.users = conv.users.filter((u) => u.toString() !== req.user._id.toString());

    if (conv.admin.toString() === req.user._id.toString()) {
      conv.admin = conv.users.length ? conv.users[0] : undefined;
    }

    if (conv.users.length === 0) {
      await ConversationModel.findByIdAndDelete(conversationId);
      return res
        .status(200)
        .json({ status: "success", message: "Group deleted as no members remained" });
    }

    await conv.save();
    await conv.populate([
      { path: "users", select: "firstName lastName avatar email" },
      { path: "admin", select: "firstName lastName avatar email" },
    ]);

    try {
      const { getIO } = await import("../../socket.js");
      const io = getIO();
      if (io) {
        conv.users.forEach((uid) => {
          io.to(uid.toString()).emit("member_left", {
            conversationId,
            userId: req.user._id,
          });
        });
      }
    } catch (err) {}

    res.status(200).json({ status: "success", conversation: conv });
  } catch (err) {
    next(err);
  }
};

/**
 * Update group meta (admin only)
 */
export const updateGroupMeta = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const { name, picture } = req.body;

    const conv = await ConversationModel.findById(conversationId);
    if (!conv) throw createHttpError.NotFound("Group not found");
    if (!conv.isGroup) throw createHttpError.BadRequest("Not a group");

    if (conv.admin.toString() !== req.user._id.toString()) {
      throw createHttpError.Forbidden("Only admin can update the group");
    }

    if (name !== undefined) conv.name = name;
    if (picture !== undefined) conv.picture = picture;

    await conv.save();
    await conv.populate([
      { path: "users", select: "firstName lastName avatar email" },
      { path: "admin", select: "firstName lastName avatar email" },
    ]);

    try {
      const { getIO } = await import("../../socket.js");
      const io = getIO();
      if (io) {
        conv.users.forEach((uid) => {
          io.to(uid.toString()).emit("group_updated", { conversation: conv });
        });
      }
    } catch (err) {}

    res.status(200).json({ status: "success", conversation: conv });
  } catch (err) {
    next(err);
  }
};

/**
 * Generate invite link (admin only)
 * POST /conversation/:conversationId/invite
 */
export const generateInvite = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const conv = await ConversationModel.findById(conversationId);

    if (!conv) return res.status(404).json({ status: "fail", message: "Conversation not found" });
    if (!conv.isGroup) return res.status(400).json({ status: "fail", message: "Not a group" });
    if (conv.admin.toString() !== req.user._id.toString()) {
      return res.status(403).json({ status: "fail", message: "Only admin can generate invite links" });
    }

    const code = nanoid(10);

    const invite = await InviteModel.create({
      code,
      conversation: conv._id,
      createdBy: req.user._id,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // expire in 7 days
    });

    res.status(201).json({
      status: "success",
      inviteLink: `${process.env.FRONT_URL}/join/${code}`,
      invite,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Join group via invite code
 * POST /conversation/join/:inviteCode
 */
export const joinByInvite = async (req, res, next) => {
  try {
    const { inviteCode } = req.params;

    const invite = await InviteModel.findOne({ code: inviteCode }).populate("conversation");

    if (!invite)
      return res.status(404).json({ status: "fail", message: "Invite not found" });

    if (invite.expiresAt < new Date()) {
      return res.status(410).json({ status: "fail", message: "Invite expired" });
    }

    const conv = await ConversationModel.findById(invite.conversation._id);
    if (!conv)
      return res.status(404).json({ status: "fail", message: "Group not found" });

    // ✅ Use $addToSet to prevent duplicate members automatically
    await ConversationModel.updateOne(
      { _id: conv._id },
      { $addToSet: { users: req.user._id } }
    );

    const updatedConv = await ConversationModel.findById(conv._id)
      .populate("users", "firstName lastName avatar email")
      .populate("admin", "firstName lastName avatar email");

    return res.status(200).json({
      status: "success",
      conversation: updatedConv,
    });
  } catch (err) {
    next(err);
  }
};

