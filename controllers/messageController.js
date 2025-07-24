const Message = require('../models/Message');
const Room = require('../models/Room');

const messageController = {
  // 채팅방 메시지 목록 조회
  async loadMessages(req, res) {
    try {
      const { roomId } = req.params;
      const { before, limit = 30 } = req.query;

      // 채팅방 권한 확인
      const room = await Room.findOne({
        _id: roomId,
        participants: req.user.id
      });

      if (!room) {
        return res.status(403).json({
          success: false,
          message: '채팅방 접근 권한이 없습니다.'
        });
      }

      // 쿼리 구성 - 로컬 삭제된 메시지 제외
      const query = { 
        room: roomId,
        localDeletedFor: { $ne: req.user.id }
      };
      
      if (before) {
        query.timestamp = { $lt: new Date(before) };
      }

      // 메시지 조회
      const messages = await Message.find(query)
        .populate('sender', 'name email profileImage')
        .populate({
          path: 'file',
          select: 'filename originalname mimetype size'
        })
        .sort({ timestamp: -1 })
        .limit(parseInt(limit) + 1)
        .lean();

      const hasMore = messages.length > parseInt(limit);
      const resultMessages = messages.slice(0, parseInt(limit));
      const sortedMessages = resultMessages.sort((a, b) => 
        new Date(a.timestamp) - new Date(b.timestamp)
      );

      res.json({
        success: true,
        data: {
          messages: sortedMessages,
          hasMore,
          oldestTimestamp: sortedMessages[0]?.timestamp || null
        }
      });

    } catch (error) {
      console.error('Load messages error:', error);
      res.status(500).json({
        success: false,
        message: '메시지를 불러오는 중 오류가 발생했습니다.'
      });
    }
  },

  // 메시지 삭제
  async deleteMessage(req, res) {
    try {
      const { messageId } = req.params;
      const userId = req.user.id;

      // 메시지 조회
      const message = await Message.findById(messageId);
      if (!message) {
        return res.status(404).json({
          success: false,
          message: '메시지를 찾을 수 없습니다.'
        });
      }

      // 권한 확인 - 본인 메시지만 삭제 가능
      if (message.sender?.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: '본인의 메시지만 삭제할 수 있습니다.'
        });
      }

      // 채팅방 권한 확인
      const room = await Room.findOne({
        _id: message.room,
        participants: userId
      });

      if (!room) {
        return res.status(403).json({
          success: false,
          message: '채팅방 접근 권한이 없습니다.'
        });
      }

      // 메시지 나이 확인 (1분 = 60000ms)
      const messageAge = new Date() - new Date(message.timestamp);
      const isOlderThanOneMinute = messageAge > 60000;

      if (isOlderThanOneMinute) {
        // 1분이 지난 메시지: 소프트 삭제 (이 사용자에게만 안 보임)
        message.localDeletedFor = message.localDeletedFor || [];
        if (!message.localDeletedFor.includes(userId)) {
          message.localDeletedFor.push(userId);
          await message.save();
        }

        // Socket.IO를 통해 개별 사용자에게만 삭제 알림
        const io = req.app.get('io');
        if (io) {
          const userSocket = [...io.sockets.sockets.values()]
            .find(socket => socket.user?.id === userId);
          
          if (userSocket) {
            userSocket.emit('messageDeleted', {
              messageId: message._id,
              deletedBy: userId,
              deleteType: 'local'
            });
          }
        }

        res.json({
          success: true,
          message: '이 기기에서만 삭제되었습니다.',
          deleteType: 'local'
        });

      } else {
        // 1분 이내 메시지: DB에서 완전 삭제
        await Message.findByIdAndDelete(messageId);

        // Socket.IO를 통해 모든 사용자에게 삭제 알림
        const io = req.app.get('io');
        if (io) {
          io.to(message.room).emit('messageDeleted', {
            messageId: message._id,
            deletedBy: userId,
            deleteType: 'global'
          });
        }

        res.json({
          success: true,
          message: '메시지가 삭제되었습니다.',
          deleteType: 'global'
        });
      }

    } catch (error) {
      console.error('Delete message error:', error);
      res.status(500).json({
        success: false,
        message: '메시지 삭제 중 오류가 발생했습니다.'
      });
    }
  }
};

module.exports = messageController; 