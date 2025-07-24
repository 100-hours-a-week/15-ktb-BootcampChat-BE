// backend/workers/readStatusConsumer.js
const amqp = require('amqplib');
const mongoose = require('mongoose');
const Message = require('../models/Message');

async function startConsumer() {
    await mongoose.connect(process.env.MONGO_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true
    });

    const conn = await amqp.connect('amqp://localhost');
    const channel = await conn.createChannel();
    const queue = 'read_status_sync';

    await channel.assertQueue(queue, { durable: true });

    console.log('[Worker] Connected to MongoDB and RabbitMQ. Waiting for messages...');

    channel.consume(queue, async (msg) => {
        if (msg !== null) {
            try {
                const payload = JSON.parse(msg.content.toString());

                // [10] 메시지 수신 로그
                console.log(`[Worker] 메시지 수신 - roomId=${payload.roomId}, userId=${payload.userId}, messageCount=${payload.messageIds.length}`);

                // [11] 유효성 검증 실패 시
                if (!payload.roomId || !payload.userId || !Array.isArray(payload.messageIds)) {
                    console.warn(`[Worker] 유효하지 않은 메시지 payload:`, payload);
                    return channel.ack(msg);
                }

                if (typeof Message.markAsRead === 'function') {
                    await Message.markAsRead(messageIds, userId);
                } else {
                    await Message.updateMany(
                        {
                            _id: { $in: messageIds },
                            'readers.userId': { $ne: userId }
                        },
                        {
                            $push: {
                                readers: {
                                    userId: userId,
                                    readAt: new Date(readAt)
                                }
                            }
                        }
                    );
                }

                // [12] 읽음 처리 성공
                console.log(`[Worker] 읽음 처리 완료 - userId=${payload.userId}, updatedMessages=${payload.messageIds.length}`);

                channel.ack(msg);
            } catch (err) {
                // [13] 예외 처리
                console.error('[Worker] 읽음 처리 중 오류 발생:', err);
                channel.nack(msg);
            }
        }
    }, { noAck: false });
}

startConsumer().catch(console.error);
