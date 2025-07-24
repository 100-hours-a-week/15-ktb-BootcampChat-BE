// backend/utils/rabbitProducer.js
require('dotenv').config();
const amqp = require('amqplib');

let channel = null;
const QUEUE_NAME = 'read_status_sync';

async function connectRabbitMQ(retry = 0) {
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 3000;

    const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

    // [1] 연결 시도 로그
    console.log(`[RabbitMQ] 연결 시도 중... (재시도 ${retry}/${MAX_RETRIES})`);
    console.log(`[RabbitMQ] 연결 대상 URL: ${RABBITMQ_URL}`);

    try {
        const connection = await amqp.connect(RABBITMQ_URL);

        // [2] 연결 성공
        console.log(`[RabbitMQ] ✅ 연결 성공 - connection established`);

        // 메시지 유실 방지를 위해 confirmChannel 사용
        channel = await connection.createConfirmChannel();

        // [3] confirmChannel 성공
        console.log(`[RabbitMQ] confirmChannel 생성 완료`);

        await channel.assertQueue(QUEUE_NAME, { durable: true });

        // [4] 큐 선언 완료
        console.log(`[RabbitMQ] 큐 선언 완료 - Queue: '${QUEUE_NAME}'`);

        console.log('[RabbitMQ] Connected and confirm channel established');
    } catch (error) {
        // [5] 연결 실패 로그
        console.error(`[RabbitMQ] 연결 실패 (attempt ${retry + 1}):`, error);

        if (retry < MAX_RETRIES) {
            setTimeout(() => connectRabbitMQ(retry + 1), RETRY_DELAY);
        } else {
            console.error('[RabbitMQ] Max retries reached. Giving up.');
        }
    }
}

async function publishReadStatus(readPayload) {
    if (!channel) {
        console.warn('[RabbitMQ] 채널이 없어서 재연결 시도 중...');
        await connectRabbitMQ();
    }

    try {
        const message = JSON.stringify(readPayload);

        // [6] 발행 시도 로그
        console.log(`[RabbitMQ] 메시지 발행 시도 - roomId=${readPayload.roomId}, userId=${readPayload.userId}, messageCount=${readPayload.messageIds.length}`);

        await channel.sendToQueue(QUEUE_NAME, Buffer.from(message), {
            persistent: true
        }, (err, ok) => {
            if (err) {
                // [7] 발행 실패
                console.error('[RabbitMQ] 메시지 발행 실패:', err);
            } else {
                // [8] 발행 성공
                console.log('[RabbitMQ] 메시지 발행 성공');
            }
        });

    } catch (error) {
        // [9] 예외 처리
        console.error('[RabbitMQ] 발행 중 예외 발생:', error);
    }
}

async function initRabbitMQConnection() {
    await connectRabbitMQ();
}

module.exports = {
    publishReadStatus,
    initRabbitMQConnection
};
