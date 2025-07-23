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
                const { roomId, userId, messageIds, readAt } = payload;

                // 유효성 검사
                if (
                    !roomId ||
                    !userId ||
                    !Array.isArray(messageIds) ||
                    messageIds.length === 0
                ) {
                    console.warn('[Worker] Invalid message payload. Skipping:', payload);
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

                channel.ack(msg);
            } catch (err) {
                console.error('[Worker] MongoDB update error:', err);
                channel.nack(msg);
            }
        }
    }, { noAck: false });
}

startConsumer().catch(console.error);
