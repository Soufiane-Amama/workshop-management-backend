// src/utils/response.js
exports.success = (res, data, message = "تم بنجاح") => {
  return res.status(200).json({ success: true, message, data });
};

exports.error = (res, message = "حدث خطأ", status = 500, details) => {
  return res.status(status).json({ success: false, message, details });
};