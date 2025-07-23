// backend/utils/rabbitProducer.js
const amqp = require('amqplib');

let channel = null;
const QUEUE_NAME = 'read_status_sync';

async function connectRabbitMQ(retry = 0) {
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 3000;

    try {
        const connection = await amqp.connect('amqp://localhost');
        // 메시지 유실 방지를 위해 confirmChannel 사용
        channel = await connection.createConfirmChannel();
        await channel.assertQueue(QUEUE_NAME, { durable: true });
        console.log('[RabbitMQ] Connected and confirm channel established');
    } catch (error) {
        console.error(`[RabbitMQ] Connection failed (attempt ${retry + 1}):`, error);

        if (retry < MAX_RETRIES) {
            setTimeout(() => connectRabbitMQ(retry + 1), RETRY_DELAY);
        } else {
            console.error('[RabbitMQ] Max retries reached. Giving up.');
        }
    }
}

async function publishReadStatus(readPayload) {
    if (!channel) {
        await connectRabbitMQ();
    }

    try {
        const message = JSON.stringify(readPayload);

        await channel.sendToQueue(QUEUE_NAME, Buffer.from(message), {
            persistent: true
        }, (err, ok) => {
            if (err) {
                console.error('[RabbitMQ] Message publish not confirmed:', err);
            }
        });

    } catch (error) {
        console.error('[RabbitMQ] Publish error:', error);
    }
}

module.exports = {
    publishReadStatus
};
