const mongoose = require('mongoose');

const connections = {
  auth: mongoose.createConnection(process.env.MONGO_URI_AUTH),
  room: mongoose.createConnection(process.env.MONGO_URI_ROOM),
  msg: mongoose.createConnection(process.env.MONGO_URI_MSG),
  file: mongoose.createConnection(process.env.MONGO_URI_FILE),
};

module.exports = connections;
