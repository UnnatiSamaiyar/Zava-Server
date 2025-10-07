import createHttpError from "http-errors";
import {
  createMessage,
  getConvoMessages,
  populateMessage,
  updateLatestMessage,
  validateFriendship,
} from "../services/messageService.js";
import { ConversationModel } from "../models/index.js";

// -------------------------- Send Message --------------------------
export const sendMessage = async (req, res, next) => {
  try {
    const user_id = req.user._id;
    const { message, convo_id, files = [] } = req.body;

    // ✅ Basic validation
    if (!convo_id || (!message && files.length === 0)) {
      return res.status(400).json({
        status: "fail",
        message: "Invalid conversation ID or empty message",
      });
    }

    // ✅ Validate conversation existence
    const convo = await ConversationModel.findById(convo_id);
    if (!convo) {
      return res.status(404).json({ status: "fail", message: "Conversation not found" });
    }

    // ✅ Allow self-chat (1-user) OR validate friendship for 1:1 chats
    if (!(convo.users.length === 1 && convo.users[0].toString() === user_id.toString())) {
      await validateFriendship(user_id, convo);
    }

    // ✅ Create new message
    const msgData = {
      sender: user_id,
      message,
      conversation: convo_id,
      files,
    };

    const newMessage = await createMessage(msgData);

    // ✅ Update latest message
    await updateLatestMessage(convo_id, newMessage);

    // ✅ Populate sender & conversation for frontend
    const populatedMessage = await populateMessage(newMessage._id);

    // ✅ Emit via socket to all members in conversation
    try {
      const { getIO } = await import("../../socket.js");
      const io = getIO();
      convo.users.forEach((uid) => {
        io.to(uid.toString()).emit("new_message", populatedMessage);
      });
    } catch (err) {
      console.log("Socket emit failed", err.message);
    }

    res.status(200).json({ status: "success", message: populatedMessage });
  } catch (error) {
    next(error);
  }
};


// -------------------------- Get All Messages --------------------------
export const getMessages = async (req, res, next) => {
  try {
    const convo_id = req.params.convo_id;

    if (!convo_id) {
      throw createHttpError.BadRequest("Conversation id is required");
    }

    const messages = await getConvoMessages(convo_id);

    res.status(200).json({ status: "success", messages: messages });
  } catch (error) {
    next(error);
  }
};

// -------------------------------------------------------------------------

// -------------------------- Socket Send Message --------------------------
export const socketSendMessage = async (socket, user_id, messageData) => {
  try {
    const { _id, message, conversation, files } = messageData;

    const convo_id = conversation._id;

    if (!convo_id || (!message && !files)) {
      throw createHttpError.BadRequest("Invalid conversation id or message");
    }

    const convo_exists = await ConversationModel.findById({ _id: convo_id });

    if (!convo_exists) {
      throw createHttpError.NotFound("Conversation does not exist");
    }

    // // Check if there's only one user in the conversation and it's the current user
    // if (
    //   !(
    //     convo_exists.users.length === 1 &&
    //     convo_exists.users[0].toString() === user_id.toString()
    //   )
    // ) {
    //   // Check if users are friends
    //   await validateFriendship(user_id, convo_exists);
    // }


    // ✅ Only validate friendship for direct (non-group) conversations
if (!convo_exists.isGroup) {
  await validateFriendship(user_id, convo_exists);
}


    const msgData = {
      _id: _id,
      sender: user_id,
      message,
      conversation: convo_id,
      files: files || [],
    };

    const newMessage = await createMessage(msgData);

    await updateLatestMessage(convo_id, newMessage);

    const populatedMessage = await populateMessage(newMessage._id);

    return { message: populatedMessage };
  } catch (error) {
    console.log(error);
    socket.errorHandler(error.message);
  }
};
