import createHttpError from "http-errors";
import validator from "validator";
import otpGenerator from "otp-generator";
import crypto from "crypto";

import { UserModel } from "../models/index.js";
import { isDisposableEmail } from "../utils/checkDispose.js";
import { filterObj } from "../utils/filterObj.js";
import otp from "../Templates/Mail/otp.js";
import { formatRemainingTime, transporter } from "../services/mailer.js";
import { generateToken, verifyToken } from "../services/tokenService.js";
import reset from "../Templates/Mail/reset.js";
import { generateLoginTokens } from "../services/authService.js";

// -------------------------- Login auth --------------------------
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw createHttpError.BadRequest("Required fields: email & password");
    }

    const user = await UserModel.findOne({ email: email }).select("+password");

    if (!user || !user.password) {
      throw createHttpError.NotFound("Incorrect Email or Password");
    }

    if (!user || !(await user.correctPassword(password, user.password))) {
      throw createHttpError.NotFound("Incorrect Email or Password");
    }

    if (!user.verified) {
      res.status(200).json({
        status: "info",
        message: `Hello ${user.firstName}, please verify to login`,
      });
      return;
    }

    const access_token = await generateLoginTokens(user, res);

    return res.status(200).json({
      status: "success",
      message: "Logged in successfully",
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        avatar: user.avatar,
        email: user.email,
        activityStatus: user.activityStatus,
        onlineStatus: user.onlineStatus,
        token: access_token,
      },
    });
  } catch (error) {
    next(error);
  }
};

// -------------------------- Register auth --------------------------
export const register = async (req, res, next) => {
  try {
    const { firstName, lastName, email, password } = req.body;
    console.log("📩 Incoming register request:", req.body);

    if (!firstName || !lastName || !email || !password) {
      console.log("❌ Missing required fields");
      throw createHttpError.BadRequest(
        "Required fields: firstName, lastName, email & password"
      );
    }

    const filteredBody = filterObj(
      req.body,
      "firstName",
      "lastName",
      "email",
      "password"
    );
    console.log("📝 Filtered Body:", filteredBody);

    if (
      !validator.isLength(firstName, { min: 3, max: 16 }) ||
      !validator.isLength(lastName, { min: 3, max: 16 })
    ) {
      console.log("❌ Name length validation failed");
      throw createHttpError.BadRequest(
        "First and Last Name each must be between 3-16 characters long"
      );
    }

    if (!validator.isAlpha(firstName) || !validator.isAlpha(lastName)) {
      console.log("❌ Name contains non-alphabetic characters");
      throw createHttpError.BadRequest(
        "First Name and Last Name can only contain alphabetic characters"
      );
    }

    if (!validator.isEmail(email)) {
      console.log("❌ Invalid Email:", email);
      throw createHttpError.BadRequest("Invalid Email");
    }

    const isDisposable = await isDisposableEmail(email);
    console.log("📮 Disposable check:", email, "=>", isDisposable);
    if (isDisposable) {
      throw createHttpError.BadRequest("Disposable emails are not allowed");
    }

    if (!validator.isStrongPassword(password)) {
      console.log("❌ Weak password attempt");
      throw createHttpError.BadRequest(
        "Password must be 8 characters long, contain atleast one number, lowercase, uppercase letters and a symbol"
      );
    }

    const existing_user = await UserModel.findOne({ email: email });
    console.log("🔎 Existing user lookup:", existing_user);

    if (existing_user && existing_user.verified) {
      console.log("⚠️ Email already registered:", email);
      throw createHttpError.Conflict("Email is already registered");
    } else if (existing_user) {
      console.log("♻️ Existing unverified user found, updating...");
      existing_user.set(filteredBody);
      await existing_user.save();

      console.log("✅ Updated user:", existing_user._id);
      req.userId = existing_user._id;
      next();
    } else {
      console.log("➕ Creating new user...");
      const new_user = await UserModel.create(filteredBody);
      console.log("✅ New user created:", new_user._id);

      req.userId = new_user.id;
      next();
    }
  } catch (error) {
    console.error("🔥 Error in register:", error.message);
    next(error);
  }
};


// -------------------------- Sending OTP --------------------------
export const sendOtp = async (req, res, next) => {
  try {
    const { userId } = req;
    const { email } = req.body;

    const user =
      (await UserModel.findOne({ email: email })) ||
      (await UserModel.findById(userId));

    if (!user) {
      throw createHttpError.NotFound("User not found, Please register");
    } else if (user.verified) {
      throw createHttpError.Conflict("User already verified, Please log in");
    }

    const lastOtpSentTime = user.otp_last_sent_time || 0;
    const cooldownPeriod = 90 * 1000;

    if (
      user.otp_last_sent_time &&
      Date.now() - lastOtpSentTime < cooldownPeriod
    ) {
      const timeRemaining = Math.ceil(
        (cooldownPeriod - (Date.now() - lastOtpSentTime)) / 1000
      );
      const remainingTimeString = formatRemainingTime(timeRemaining);

      throw createHttpError.TooEarly(
        `Please wait ${remainingTimeString} before requesting a new OTP`
      );
    }

    const new_otp = otpGenerator.generate(6, {
      lowerCaseAlphabets: false,
      specialChars: false,
    });

    const otp_expiry_time = Date.now() + 10 * 60 * 1000;

    user.otp = new_otp;
    user.otp_expiry_time = otp_expiry_time;
    user.otp_last_sent_time = Date.now();
    user.otp_verify_attempts = 0;

    await user.save();

    const emailDetails = {
      from: `Zava <${process.env.MAIL_USER}>`,
      to: user.email,
      subject: "Zava - Here's your OTP",
      html: otp(user.firstName, new_otp),
    };

    try {
      await transporter.sendMail(emailDetails);
      return res.status(200).json({
        status: "success",
        message: "OTP Sent",
      });
    } catch (error) {
      throw createHttpError.InternalServerError(`Failed to send OTP: ${error}`);
    }
  } catch (error) {
    next(error);
  }
};

// -------------------------- Verifying OTP --------------------------
export const verifyOTP = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      throw createHttpError.BadGateway("Required fields: email & otp");
    }

    const user = await UserModel.findOne({ email });

    if (
      !user ||
      (!user.verified &&
        user.otp_expiry_time &&
        user.otp_expiry_time <= Date.now())
    ) {
      throw createHttpError.BadRequest("OTP Expired or Invalid Email");
    }

    if (user.verified) {
      throw createHttpError.Conflict("Email is already verified");
    }

    if (!user.otp) {
      throw createHttpError.NotFound("Please Resend OTP");
    }

    if (user.otp_verify_attempts && user.otp_verify_attempts >= 5) {
      throw createHttpError.TooManyRequests(
        "Verify attempts exceeded, please request a new otp"
      );
    }

    user.otp_verify_attempts = user.otp_verify_attempts + 1;
    user.save();

    if (!(await user.correctOTP(otp, user.otp, next))) {
      throw createHttpError.Unauthorized("Incorrect OTP");
    }

    user.verified = true;
    user.otp = undefined;
    user.otp_expiry_time = undefined;
    user.otp_last_sent_time = undefined;
    user.otp_verify_attempts = undefined;

    await user.save({ new: true, validateModifiedOnly: true });

    const access_token = await generateLoginTokens(user, res);

    return res.status(200).json({
      status: "success",
      message: "OTP verified",
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        avatar: user.avatar,
        email: user.email,
        activityStatus: user.activityStatus,
        onlineStatus: user.onlineStatus,
        token: access_token,
      },
    });
  } catch (error) {
    next(error);
  }
};

// -------------------------- Forgot Password --------------------------
export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      throw createHttpError.BadRequest("Required field: email");
    }

    const user = await UserModel.findOne({ email: email });

    if (!user) {
      throw createHttpError.NotFound("Email is not registered");
    }

    const lastResetLinkTime = user.passwordResetLastSent || 0;
    const cooldownPeriod = 90 * 1000;

    if (
      user.passwordResetLastSent &&
      Date.now() - lastResetLinkTime < cooldownPeriod
    ) {
      const timeRemaining = Math.ceil(
        (cooldownPeriod - (Date.now() - lastResetLinkTime)) / 1000
      );
      const remainingTimeString = formatRemainingTime(timeRemaining);

      throw createHttpError.TooEarly(
        `Please wait ${remainingTimeString} before requesting a new reset link`
      );
    }

    const resetToken = await user.createPasswordResetToken();
    user.passwordResetLastSent = Date.now();

    await user.save();

    const resetURL = `${process.env.FRONT_URL}/auth/reset-password/?code=${resetToken}`;

    const emailDetails = {
      from: `Zava <${process.env.MAIL_USER}>`,
      to: user.email,
      subject: "Zava - Here's your Password Reset Link",
      html: reset(user.firstName, resetURL),
    };

    await transporter
      .sendMail(emailDetails)
      .then(() => {
        return res.status(200).json({
          status: "success",
          message: "Reset Password link sent",
        });
      })
      .catch((error) => {
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        user.passwordResetLastSent = undefined;
        user.save({ validateBeforeSave: false });

        throw createHttpError.InternalServerError(error);
      });
  } catch (error) {
    next(error);
  }
};

// -------------------------- Reset Password --------------------------
export const resetPassword = async (req, res, next) => {
  try {
    if (!req.body.token) {
      throw createHttpError.BadRequest("Required field: token");
    }

    const hashedToken = crypto
      .createHash("sha256")
      .update(req.body.token)
      .digest("hex");

    const user = await UserModel.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() },
    });

    if (!user) {
      throw createHttpError.BadRequest("Token Expired or Invalid Token");
    }

    user.password = req.body.password;
    user.passwordConfirm = req.body.passwordConfirm;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.passwordResetLastSent = undefined;

    if (user.password !== user.passwordConfirm) {
      throw createHttpError.BadRequest(
        "Password and Confirm Password does not match"
      );
    }

    if (!validator.isStrongPassword(user.password)) {
      throw createHttpError.BadRequest(
        "Password must be 8 characters long, contain atleast one number, lowercase, uppercase letters and a symbol"
      );
    }

    await user.save();

    return res.status(200).json({
      status: "success",
      message: "Password Reset Successfully",
    });
  } catch (error) {
    next(error);
  }
};

// -------------------------- Logout auth --------------------------
export const logout = async (req, res, next) => {
  try {
    res.clearCookie("accessToken");
    res.clearCookie("refreshToken", { path: "/api/auth/refreshToken" });
    res.status(200).json({
      status: "success",
      message: "Logged out successfully",
    });
  } catch (error) {
    next(error);
  }
};

// -------------------------- Refresh Token --------------------------
export const refreshToken = async (req, res, next) => {
  try {
    const refresh_token = req.cookies.refreshToken;

    if (!refresh_token) throw createHttpError.Forbidden("Please login");

    const check = await verifyToken(
      refresh_token,
      process.env.JWT_REFRESH_SECRET
    );

    const user = await UserModel.findOne({ _id: check.userId, verified: true });

    if (!user) {
      throw createHttpError.NotFound("User not verified/does not exist");
    }

    const access_token = await generateToken(
      { userId: user._id },
      "1d",
      process.env.JWT_ACCESS_SECRET
    );

    res.cookie("accessToken", access_token, {
      httpOnly: true,
      secure: true,
      maxAge: 1 * 24 * 60 * 60 * 1000,
      sameSite: "none",
      priority: "high",
    });

    return res.status(200).json({
      status: "success",
      message: "Token Refreshed",
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        avatar: user.avatar,
        email: user.email,
        activityStatus: user.activityStatus,
        onlineStatus: user.onlineStatus,
        token: access_token,
      },
    });
  } catch (error) {
    next(error);
  }
};
