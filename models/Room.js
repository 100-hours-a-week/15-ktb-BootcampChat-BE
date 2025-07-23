const { Schema, SchemaTypes } = require('mongoose');
const bcrypt = require('bcryptjs');

// 커넥션 불러오기 
const connections = require('./index');

const RoomSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  creator: {
    type: SchemaTypes.ObjectId,
    ref: 'User',
    required: true
  },
  hasPassword: {
    type: Boolean,
    default: false
  },
  password: {
    type: String,
    select: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  participants: [{
    type: SchemaTypes.ObjectId,
    ref: 'User'
  }]
});

// 비밀번호 해싱 미들웨어
RoomSchema.pre('save', async function(next) {
  if (this.isModified('password') && this.password) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    this.hasPassword = true;
  }
  if (!this.password) {
    this.hasPassword = false;
  }
  next();
});

// 비밀번호 확인 메서드
RoomSchema.methods.checkPassword = async function(password) {
  if (!this.hasPassword) return true;
  const room = await this.constructor.findById(this._id).select('+password');
  return await bcrypt.compare(password, room.password);
};

module.exports = connections.room.model('Room', RoomSchema);